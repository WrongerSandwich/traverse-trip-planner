import { PROVIDERS } from './providers.js';
import * as anthropic from './ai/anthropic.js';
import * as openai from './ai/openai.js';
import * as openrouter from './ai/openrouter.js';
import { recordInvocation } from './workflow-stats.js';
import { TraverseError } from './errors.js';
export { formatUsage } from '../utils/format.js';

// Hard ceiling on maxTokens. Provider APIs cap at 128–200k, but a buggy caller
// requesting 1M is still a cost-DoS — this catches typos and runaway loops
// before they hit the wire.
export const MAX_TOKENS_CEILING = 100_000;


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
  if (typeof provider !== 'string' || !provider) {
    throw new TraverseError('feature_not_configured', `chat() called with provider=${provider}; check cfg.features[<label>] is populated`);
  }
  if (typeof model !== 'string' || !model) {
    throw new TraverseError('feature_not_configured', `chat() called with model=${model}; check cfg.features[<label>] is populated`);
  }
  if (typeof maxTokens === 'number' && maxTokens > MAX_TOKENS_CEILING) {
    throw new TraverseError('max_tokens_exceeded', `maxTokens=${maxTokens} exceeds ceiling=${MAX_TOKENS_CEILING}`);
  }
  const providerMeta = PROVIDERS[provider];
  if (!providerMeta) throw new Error(`No AI adapter registered for provider "${provider}".`);
  if (hasImages(messages) && !providerMeta.supportsImages) {
    throw new Error(`Configured provider "${provider}" does not support image input.`);
  }
  const adapter = adapters[provider];
  const start = Date.now();
  let u = {};
  try {
    const result = await adapter.chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity, signal, onText });
    u = result.usage || {};
    return result;
  } finally {
    const end = Date.now();
    const ms = end - start;
    const tag = label ? `${label} ` : '';
    console.log(`[ai] ${tag}${provider}/${model} — ${u.input ?? 0} in / ${u.output ?? 0} out (${u.turns ?? 1} turn${u.turns === 1 ? '' : 's'}, ${ms}ms)`);
    // Best-effort telemetry hook for `_promise` calibration. Failures here must
    // never affect the caller — see src/lib/server/workflow-stats.js.
    // Both success and error paths record; errors pass zero token counts.
    if (label) {
      try {
        recordInvocation({
          label,
          startMs: start,
          endMs: end,
          tokensIn: u.input ?? 0,
          tokensOut: u.output ?? 0,
        });
      } catch (e) {
        console.warn(`[workflow-stats] record hook failed: ${e?.message ?? e}`);
      }
    }
  }
}
