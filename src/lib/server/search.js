import { getEffectiveConfig } from './config.js';
import * as anthropicBuiltin from './search/anthropic-builtin.js';
import * as tavily from './search/tavily.js';

const backends = {
  'anthropic-builtin': anthropicBuiltin,
  tavily,
};

// Resolve the backend per call (not once at module load) so changes saved via
// the Settings UI to TRAVERSE_SEARCH_PROVIDER take effect on the next request.
function backend() {
  const provider = getEffectiveConfig().search.provider;
  const b = backends[provider];
  if (!b) throw new Error(`No search backend registered for provider "${provider}".`);
  return b;
}

export function searchToolDefinition() {
  return backend().searchToolDefinition();
}

export async function search(args) {
  return backend().search(args);
}
