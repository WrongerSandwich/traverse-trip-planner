import Anthropic from '@anthropic-ai/sdk';
import { AdapterError, formatSummary, logAdapterError } from '../errors.js';
import { findTool } from './utils.js';

const MAX_TOOL_TURNS = 20;

function translateTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => {
    if (t.kind === 'anthropic-native') return t.spec;
    return {
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    };
  });
}

function isNativeTool(tool) {
  return tool.kind === 'anthropic-native';
}


function extractText(content) {
  return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function accumUsage(acc, u) {
  if (!u) return acc;
  acc.input += u.input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.turns += 1;
  return acc;
}

export async function chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity, signal, onText }) {
  const client = new Anthropic();
  const apiTools = translateTools(tools);
  const usage = { input: 0, output: 0, total: 0, turns: 0 };

  // Streaming path: when onText is set and there are no tools, stream text chunks
  // through the callback. Tools + streaming together aren't supported here — tool
  // loops require synchronous decisions that don't compose cleanly with token
  // streaming. (Lock is the only consumer today; lock has no tools.)
  if (onText && (!apiTools || apiTools.length === 0)) {
    return streamChat({ client, model, system, messages, maxTokens, signal, onText, usage });
  }

  let convo = messages.map(m => ({ ...m }));

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        ...(apiTools ? { tools: apiTools } : {}),
        messages: convo,
      }, signal ? { signal } : undefined);
    } catch (err) {
      const status = err?.status;
      const detail = err?.error?.error?.message || err?.message;
      const wrapped = new AdapterError({
        provider: 'anthropic',
        model,
        status,
        summary: formatSummary({ provider: 'anthropic', model, status, detail }),
        cause: err,
      });
      logAdapterError(wrapped);
      throw wrapped;
    }
    accumUsage(usage, response.usage);
    usage.total = usage.input + usage.output;

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      return { text: extractText(response.content), usage };
    }

    if (response.stop_reason !== 'tool_use') {
      const text = extractText(response.content);
      if (text) return { text, usage };
      throw new Error(`Anthropic adapter: unexpected stop_reason "${response.stop_reason}".`);
    }

    convo = [...convo, { role: 'assistant', content: response.content }];

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const tool = findTool(tools, block.name);
      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: unknown tool "${block.name}"`, is_error: true });
        continue;
      }
      onActivity?.({ type: 'tool_call', name: block.name, input: block.input });
      if (isNativeTool(tool)) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: '' });
      } else {
        let result;
        try {
          result = await onToolCall?.({ name: block.name, input: block.input });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
          continue;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result ?? null),
        });
      }
    }

    if (toolResults.length === 0) {
      const text = extractText(response.content);
      if (text) return { text, usage };
      throw new Error('Anthropic adapter: tool_use stop with no tool_use blocks.');
    }

    convo = [...convo, { role: 'user', content: toolResults }];
  }

  throw new Error(`Anthropic adapter: hit ${MAX_TOOL_TURNS}-turn safety limit.`);
}

async function streamChat({ client, model, system, messages, maxTokens, signal, onText, usage }) {
  if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
  let final;
  try {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    }, signal ? { signal } : undefined);
    stream.on('text', (chunk) => {
      try { onText(chunk); } catch { /* user callback errors don't kill the stream */ }
    });
    final = await stream.finalMessage();
  } catch (err) {
    const status = err?.status;
    const detail = err?.error?.error?.message || err?.message;
    const wrapped = new AdapterError({
      provider: 'anthropic',
      model,
      status,
      summary: formatSummary({ provider: 'anthropic', model, status, detail }),
      cause: err,
    });
    logAdapterError(wrapped);
    throw wrapped;
  }
  accumUsage(usage, final.usage);
  usage.total = usage.input + usage.output;
  return { text: extractText(final.content), usage };
}
