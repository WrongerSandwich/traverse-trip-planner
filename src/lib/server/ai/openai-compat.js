// Shared utilities for OpenAI-compatible adapters (openai.js and openrouter.js).
// Both adapters speak the same wire format, so all pure-transformation helpers
// live here to avoid drift between the two implementations.

export function translateTools(tools, providerName = 'OpenAI-compatible adapter') {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => {
    if (t.kind === 'anthropic-native') {
      throw new Error(`${providerName} cannot use anthropic-native tool "${t.spec?.name}". Set TRAVERSE_SEARCH_PROVIDER to a portable backend (e.g. tavily).`);
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

// TODO: findTool is also duplicated in anthropic.js — worth consolidating into
// a shared adapter-agnostic util if a third adapter is ever added.
export function findTool(tools, name) {
  return tools?.find(t => (t.kind === 'anthropic-native' ? t.spec.name : t.name) === name);
}

// Translate a single content block from the normalized internal format to the
// OpenAI wire format. Non-image blocks pass through unchanged.
export function translateBlock(block) {
  if (block.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${block.mediaType};base64,${block.data}` },
    };
  }
  return block;
}

export function translateMessages(messages) {
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    return { ...m, content: m.content.map(translateBlock) };
  });
}

export function accumUsage(acc, u) {
  if (!u) return acc;
  acc.input += u.prompt_tokens || 0;
  acc.output += u.completion_tokens || 0;
  acc.turns += 1;
  return acc;
}
