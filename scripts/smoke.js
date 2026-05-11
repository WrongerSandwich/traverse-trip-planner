#!/usr/bin/env node
// Traverse provider smoke test.
//   node scripts/smoke.js
// Verifies that each configured model and search backend is reachable
// with the current .env. Costs a few cents in tokens.

import 'dotenv/config';
import { chat } from '../src/lib/server/ai.js';
import { search, searchToolDefinition } from '../src/lib/server/search.js';
import { config, describeConfig } from '../src/lib/server/config.js';

const d = describeConfig();
const openrouterKey = process.env.OPENROUTER_API_KEY;
console.log('Traverse smoke test');
console.log('────────────────────────────────────────────');
console.log(`  default model  : ${d.modelDefault.provider}/${d.modelDefault.model}${d.modelDefault.ok ? '' : '  ✗ no key'}`);
console.log(`  research model : ${d.modelResearch.provider}/${d.modelResearch.model}${d.modelResearch.ok ? '' : '  ✗ no key'}`);
console.log(`  search backend : ${d.search.provider}${d.search.ok ? '' : '  ✗ no key'}`);
console.log(`  openrouter key : ${openrouterKey ? 'set' : 'not set'}`);
if (d.issues.length > 0) {
  console.log('  config issues:');
  for (const issue of d.issues) console.log(`    • ${issue}`);
}
console.log('────────────────────────────────────────────');

let passed = 0;
let failed = 0;

async function probe(name, fn) {
  process.stdout.write(`  ${name.padEnd(38)} `);
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`✓ (${ms}ms)`);
    passed++;
  } catch (err) {
    console.log(`✗ ${err.message}`);
    failed++;
  }
}

const tinyMessages = [{ role: 'user', content: 'Reply with the single word OK and nothing else.' }];

if (d.modelDefault.ok) {
  await probe(`chat() default — ${d.modelDefault.provider}`, async () => {
    const { text } = await chat({ ...config.modelDefault, system: 'Be terse.', messages: tinyMessages, maxTokens: 10 });
    if (!text.trim()) throw new Error('empty response');
  });
} else {
  console.log(`  chat() default${' '.repeat(24)} — skipped (key missing)`);
}

if (d.modelResearch.ok) {
  await probe(`chat() research — ${d.modelResearch.provider}`, async () => {
    const { text } = await chat({ ...config.modelResearch, system: 'Be terse.', messages: tinyMessages, maxTokens: 10 });
    if (!text.trim()) throw new Error('empty response');
  });
} else {
  console.log(`  chat() research${' '.repeat(23)} — skipped (key missing)`);
}

if (d.search.provider === 'anthropic-builtin') {
  console.log(`  search()${' '.repeat(30)} — n/a (server-side; exercised via /deepen)`);
} else if (d.search.ok) {
  await probe(`search() — ${d.search.provider}`, async () => {
    const results = await search({ query: 'OpenStreetMap', maxResults: 1 });
    if (!Array.isArray(results) || results.length === 0) throw new Error('no results');
  });
} else {
  console.log(`  search()${' '.repeat(30)} — skipped (key missing)`);
}

// Tool-loop seam: only meaningful for non-builtin search backends, which forces
// chat() to translate normalized tool definitions and route tool_calls through
// onToolCall. This is the abstraction's biggest unverified path on Anthropic
// and the entire portable path on OpenAI.
if (d.search.provider !== 'anthropic-builtin' && d.modelResearch.ok && d.search.ok) {
  await probe(`tool loop — ${d.modelResearch.provider} + ${d.search.provider}`, async () => {
    let toolCalled = false;
    const { text } = await chat({
      ...config.modelResearch,
      label: 'smoke-tool-loop',
      system: 'You have a web_search tool. When asked a factual question, you must call it before answering.',
      messages: [{ role: 'user', content: 'In what year was Yellowstone established as a national park? Use web_search to verify.' }],
      maxTokens: 400,
      tools: [searchToolDefinition()],
      onActivity: ({ type, name }) => { if (type === 'tool_call' && name === 'web_search') toolCalled = true; },
      onToolCall: async ({ name, input }) => {
        if (name === 'web_search') return search({ query: input.query, maxResults: 3 });
        return null;
      },
    });
    if (!toolCalled) throw new Error('model did not call web_search');
    if (!text.trim()) throw new Error('empty final response');
  });
} else if (d.search.provider !== 'anthropic-builtin') {
  console.log(`  tool loop${' '.repeat(29)} — skipped (research model or search key missing)`);
} else {
  console.log(`  tool loop${' '.repeat(29)} — skipped (anthropic-builtin doesn't go through normalized-tool path)`);
}

// OpenRouter probe: independent of the main provider slots; runs when OPENROUTER_API_KEY is set.
if (openrouterKey) {
  const orModel = process.env.OPENROUTER_SMOKE_MODEL || 'anthropic/claude-3.5-haiku';
  await probe(`chat() openrouter — ${orModel}`, async () => {
    const { text } = await chat({ provider: 'openrouter', model: orModel, system: 'Be terse.', messages: tinyMessages, maxTokens: 10, label: 'smoke-openrouter' });
    if (!text.trim()) throw new Error('empty response');
  });

  const tav = d.search.provider === 'tavily' && d.search.ok;
  if (tav) {
    await probe(`tool loop — openrouter + ${d.search.provider}`, async () => {
      let toolCalled = false;
      const { text } = await chat({
        provider: 'openrouter',
        model: orModel,
        label: 'smoke-openrouter-tool-loop',
        system: 'You have a web_search tool. When asked a factual question, you must call it before answering.',
        messages: [{ role: 'user', content: 'In what year was Yellowstone established as a national park? Use web_search to verify.' }],
        maxTokens: 400,
        tools: [searchToolDefinition()],
        onActivity: ({ type, name }) => { if (type === 'tool_call' && name === 'web_search') toolCalled = true; },
        onToolCall: async ({ name, input }) => {
          if (name === 'web_search') return search({ query: input.query, maxResults: 3 });
          return null;
        },
      });
      if (!toolCalled) throw new Error('model did not call web_search');
      if (!text.trim()) throw new Error('empty final response');
    });
  } else {
    console.log(`  tool loop (openrouter)${' '.repeat(16)} — skipped (tavily key required)`);
  }
} else {
  console.log(`  chat() openrouter${' '.repeat(20)} — skipped (OPENROUTER_API_KEY not set)`);
}

console.log('────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
