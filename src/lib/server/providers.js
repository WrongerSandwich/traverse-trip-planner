// Single source of truth for AI provider metadata.
//
// Rules for this file: NO imports. It must stay a pure-data module so that
// settings.js (whose adapter modules in turn import settings.js) can import
// from here without creating a circular dependency.
//
// Adding a new provider: add an entry here, create the adapter at
// src/lib/server/ai/<name>.js, and import it in ai.js.

// supportsImages: if true, the adapter MUST translate normalized
// {type:'image', mediaType, data} content blocks to the provider's wire
// format. chat() in ai.js enforces this at dispatch time.
export const PROVIDERS = {
  anthropic:  { envKey: 'ANTHROPIC_API_KEY',  supportsImages: true },
  openai:     { envKey: 'OPENAI_API_KEY',      supportsImages: true },
  openrouter: { envKey: 'OPENROUTER_API_KEY',  supportsImages: true },
};

// Safety cap on agentic tool-use loops. All adapters import this constant so
// the ceiling stays in sync across providers.
export const MAX_TOOL_TURNS = 20;
