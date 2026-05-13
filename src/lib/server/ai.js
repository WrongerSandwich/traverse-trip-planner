import { PROVIDERS } from './providers.js';
import * as anthropic from './ai/anthropic.js';
import * as openai from './ai/openai.js';
import * as openrouter from './ai/openrouter.js';
export { formatUsage } from '../utils/format.js';

// Build the adapters map from PROVIDERS so the two stay in sync: if a provider
// is listed here but its adapter isn't imported above, the lookup below throws
// at startup rather than silently failing at runtime.
const _adapterModules = { anthropic, openai, openrouter };
const adapters = Object.fromEntries(
  Object.keys(PROVIDERS).map(name => {
    const mod = _adapterModules[name];
    if (!mod) throw new Error(`No adapter module imported for provider "${name}".`);
    return [name, mod];
  })
);

function hasImages(messages) {
  return messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image'));
}

export async function chat({ provider, model, system, messages, maxTokens, tools, onToolCall, onActivity, label, signal, onText }) {
  const providerMeta = PROVIDERS[provider];
  if (!providerMeta) throw new Error(`No AI adapter registered for provider "${provider}".`);
  if (hasImages(messages) && !providerMeta.supportsImages) {
    throw new Error(`Configured provider "${provider}" does not support image input.`);
  }
  const adapter = adapters[provider];
  const start = Date.now();
  const result = await adapter.chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity, signal, onText });
  const ms = Date.now() - start;
  const u = result.usage || {};
  const tag = label ? `${label} ` : '';
  console.log(`[ai] ${tag}${provider}/${model} — ${u.input ?? 0} in / ${u.output ?? 0} out (${u.turns ?? 1} turn${u.turns === 1 ? '' : 's'}, ${ms}ms)`);
  return result;
}
