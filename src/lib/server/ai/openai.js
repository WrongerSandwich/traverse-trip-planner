import { withRetry } from '../retry.js';
import { adapterErrorFromResponse, logAdapterError } from '../errors.js';
import { resolveEnv } from '../settings.js';
import { translateTools, findTool, translateMessages, accumUsage } from './openai-compat.js';
import { MAX_TOOL_TURNS } from '../providers.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

async function callApi({ apiKey, model, maxTokens, tools, messages, signal }) {
  return withRetry(async () => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(tools ? { tools } : {}),
        messages,
      }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const cause = await res.text();
      const err = adapterErrorFromResponse({ provider: 'openai', model, status: res.status, cause });
      logAdapterError(err);
      throw err;
    }
    return res.json();
  }, { label: `openai ${model}`, signal });
}

export async function chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity, signal, onText }) {
  const apiTools = translateTools(tools, 'OpenAI adapter');
  const apiKey = resolveEnv('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set.');
  const usage = { input: 0, output: 0, total: 0, turns: 0 };
  let convo = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...translateMessages(messages).map(m => ({ role: m.role, content: m.content })),
  ];

  // Streaming path: when onText is set and no tools, pipe deltas through callback.
  if (onText && (!apiTools || apiTools.length === 0)) {
    return streamChat({ apiKey, model, maxTokens, messages: convo, signal, onText, usage });
  }

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    const data = await callApi({ apiKey, model, maxTokens, tools: apiTools, messages: convo, signal });
    accumUsage(usage, data.usage);
    usage.total = usage.input + usage.output;

    const choice = data.choices?.[0];
    if (!choice) throw new Error('OpenAI adapter: no choices returned.');

    const message = choice.message;
    const finish = choice.finish_reason;

    if (finish === 'stop' || finish === 'length') {
      return { text: message.content ?? '', usage };
    }

    if (finish === 'tool_calls') {
      convo = [...convo, message];

      const toolMessages = [];
      for (const call of message.tool_calls ?? []) {
        const name = call.function?.name;
        let input;
        try {
          input = JSON.parse(call.function?.arguments ?? '{}');
        } catch {
          input = {};
        }
        const tool = findTool(tools, name);
        if (!tool) {
          toolMessages.push({ role: 'tool', tool_call_id: call.id, content: `Error: unknown tool "${name}"` });
          continue;
        }
        onActivity?.({ type: 'tool_call', name, input });
        let result;
        try {
          result = await onToolCall?.({ name, input });
        } catch (err) {
          toolMessages.push({ role: 'tool', tool_call_id: call.id, content: `Error: ${err.message}` });
          continue;
        }
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result ?? null),
        });
      }

      if (toolMessages.length === 0) {
        return { text: message.content ?? '', usage };
      }

      convo = [...convo, ...toolMessages];
      continue;
    }

    return { text: message.content ?? '', usage };
  }

  throw new Error(`OpenAI adapter: hit ${MAX_TOOL_TURNS}-turn safety limit.`);
}

async function streamChat({ apiKey, model, maxTokens, messages, signal, onText, usage }) {
  if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const cause = await res.text();
    const err = adapterErrorFromResponse({ provider: 'openai', model, status: res.status, cause });
    logAdapterError(err);
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullText = '';

  while (true) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      if (event.usage) accumUsage(usage, event.usage);
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        try { onText(delta); } catch { /* user callback errors don't kill the stream */ }
      }
    }
  }

  usage.total = usage.input + usage.output;
  if (usage.turns === 0) usage.turns = 1; // streaming counts as one turn even if usage event was missing
  return { text: fullText, usage };
}
