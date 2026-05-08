export function searchToolDefinition() {
  return {
    kind: 'anthropic-native',
    spec: { type: 'web_search_20250305', name: 'web_search' },
  };
}

export async function search() {
  throw new Error('anthropic-builtin search runs server-side; call via chat() with the tool definition instead of search() directly.');
}
