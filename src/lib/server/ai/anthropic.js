import Anthropic from '@anthropic-ai/sdk';
import { AdapterError, formatSummary, logAdapterError } from '../errors.js';

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

function findTool(tools, name) {
  return tools?.find(t => (t.kind === 'anthropic-native' ? t.spec.name : t.name) === name);
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

export async function chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity }) {
  const client = new Anthropic();
  const apiTools = translateTools(tools);
  const usage = { input: 0, output: 0, total: 0, turns: 0 };

  let convo = messages.map(m => ({ ...m }));

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        ...(apiTools ? { tools: apiTools } : {}),
        messages: convo,
      });
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
