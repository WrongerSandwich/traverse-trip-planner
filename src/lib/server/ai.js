import * as anthropic from './ai/anthropic.js';
import * as openai from './ai/openai.js';
import * as openrouter from './ai/openrouter.js';
export { formatUsage } from '../utils/format.js';

const adapters = { anthropic, openai, openrouter };

export async function chat({ provider, model, system, messages, maxTokens, tools, onToolCall, onActivity, label, signal, onText }) {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`No AI adapter registered for provider "${provider}".`);
  const start = Date.now();
  const result = await adapter.chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity, signal, onText });
  const ms = Date.now() - start;
  const u = result.usage || {};
  const tag = label ? `${label} ` : '';
  console.log(`[ai] ${tag}${provider}/${model} — ${u.input ?? 0} in / ${u.output ?? 0} out (${u.turns ?? 1} turn${u.turns === 1 ? '' : 's'}, ${ms}ms)`);
  return result;
}
