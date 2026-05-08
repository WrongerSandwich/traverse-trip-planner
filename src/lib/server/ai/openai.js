import { withRetry } from '../retry.js';
import { adapterErrorFromResponse, logAdapterError } from '../errors.js';

const MAX_TOOL_TURNS = 20;
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function translateTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => {
    if (t.kind === 'anthropic-native') {
      throw new Error(`OpenAI adapter cannot use anthropic-native tool "${t.spec?.name}". Set ATLAS_SEARCH_PROVIDER to a portable backend (e.g. tavily).`);
    }
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    };
  });
}

function findTool(tools, name) {
  return tools?.find(t => (t.kind === 'anthropic-native' ? t.spec.name : t.name) === name);
}

async function callApi({ apiKey, model, maxTokens, tools, messages }) {
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
    });
    if (!res.ok) {
      const cause = await res.text();
      const err = adapterErrorFromResponse({ provider: 'openai', model, status: res.status, cause });
      logAdapterError(err);
      throw err;
    }
    return res.json();
  }, { label: `openai ${model}` });
}

function accumUsage(acc, u) {
  if (!u) return acc;
  acc.input += u.prompt_tokens || 0;
  acc.output += u.completion_tokens || 0;
  acc.turns += 1;
  return acc;
}

export async function chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity }) {
  const apiTools = translateTools(tools);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set.');
  const usage = { input: 0, output: 0, total: 0, turns: 0 };
  let convo = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const data = await callApi({ apiKey, model, maxTokens, tools: apiTools, messages: convo });
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
