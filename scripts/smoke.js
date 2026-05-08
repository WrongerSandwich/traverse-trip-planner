#!/usr/bin/env node
// Atlas provider smoke test.
//   node scripts/smoke.js
// Verifies that each configured model and search backend is reachable
// with the current .env. Costs a few cents in tokens.

import 'dotenv/config';
import { chat } from '../src/lib/server/ai.js';
import { search } from '../src/lib/server/search.js';
import { config, describeConfig } from '../src/lib/server/config.js';

const d = describeConfig();
console.log('Atlas smoke test');
console.log('────────────────────────────────────────────');
console.log(`  default model  : ${d.modelDefault.provider}/${d.modelDefault.model}${d.modelDefault.ok ? '' : '  ✗ no key'}`);
console.log(`  research model : ${d.modelResearch.provider}/${d.modelResearch.model}${d.modelResearch.ok ? '' : '  ✗ no key'}`);
console.log(`  search backend : ${d.search.provider}${d.search.ok ? '' : '  ✗ no key'}`);
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

console.log('────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
