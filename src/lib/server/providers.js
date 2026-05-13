// Single source of truth for AI provider metadata.
//
// Rules for this file: NO imports. It must stay a pure-data module so that
// settings.js (whose adapter modules in turn import settings.js) can import
// from here without creating a circular dependency.
//
// Adding a new provider: add an entry here, create the adapter at
// src/lib/server/ai/<name>.js, and import it in ai.js.

export const PROVIDERS = {
  anthropic:  { envKey: 'ANTHROPIC_API_KEY',  supportsImages: true },
  openai:     { envKey: 'OPENAI_API_KEY',      supportsImages: true },
  openrouter: { envKey: 'OPENROUTER_API_KEY',  supportsImages: true },
};
