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

// Cumulative output-token ceiling across an entire tool-loop request.
//
// `MAX_TOKENS_CEILING` (ai.js) bounds a *single* call's requested output
// budget, but the tool loop above can run up to MAX_TOOL_TURNS turns, each
// entitled to that full per-turn budget — so a search-heavy run could spend
// ~MAX_TOOL_TURNS× the intended output with no abort (#495). This cap bounds
// the sum of output tokens actually produced across all turns of one request;
// the adapter aborts with a typed `max_tokens_exceeded` failure once it's
// exceeded. 200k generously covers a legitimate 20-turn deepen (real turns
// emit a few thousand output tokens each) while still catching a loop that
// burns the full per-turn output budget every turn.
export const MAX_CUMULATIVE_OUTPUT_TOKENS = 200_000;
