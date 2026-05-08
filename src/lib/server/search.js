import { config } from './config.js';
import * as anthropicBuiltin from './search/anthropic-builtin.js';
import * as tavily from './search/tavily.js';

const backends = {
  'anthropic-builtin': anthropicBuiltin,
  tavily,
};

function backend() {
  const b = backends[config.search.provider];
  if (!b) throw new Error(`No search backend registered for provider "${config.search.provider}".`);
  return b;
}

export function searchToolDefinition() {
  return backend().searchToolDefinition();
}

export async function search(args) {
  return backend().search(args);
}
