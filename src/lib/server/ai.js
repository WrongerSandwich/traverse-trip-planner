import * as anthropic from './ai/anthropic.js';
import * as openai from './ai/openai.js';

const adapters = { anthropic, openai };

export async function chat({ provider, model, system, messages, maxTokens, tools, onToolCall, onActivity }) {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`No AI adapter registered for provider "${provider}".`);
  return adapter.chat({ model, system, messages, maxTokens, tools, onToolCall, onActivity });
}
