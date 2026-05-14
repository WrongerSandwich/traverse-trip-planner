// Load .env for production (Vite handles this automatically in dev)
import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describeConfig } from '$lib/server/config.js';
import { ROOT, parseFrontmatter, removeFrontmatterField } from '$lib/server/data.js';
import { sweepStaleJobs } from '$lib/server/jobs.js';

let banneredOnce = false;

function printConfigBanner() {
  if (banneredOnce) return;
  banneredOnce = true;

  const d = describeConfig();
  const fmt = (slot) => `${slot.provider}/${slot.model} ${slot.ok ? '✓' : '✗'}`;

  console.log('────────────────────────────────────────────');
  console.log('Traverse — provider configuration');
  console.log(`  default model  : ${fmt(d.modelDefault)}`);
  console.log(`  research model : ${fmt(d.modelResearch)}`);
  console.log(`  search backend : ${d.search.provider} ${d.search.ok ? '✓' : '✗'}`);
  console.log('  features:');
  for (const [name, info] of Object.entries(d.features)) {
    const status = info.ok ? '✓' : '✗';
    const detail = `${info.provider}/${info.model}${info.overridden ? ' (override)' : ''}`;
    const tail = info.ok ? '' : ' (unavailable — see env)';
    console.log(`    ${name.padEnd(7)} ${status} ${detail}${tail}`);
  }
  if (d.issues.length > 0) {
    console.log('  config issues:');
    for (const issue of d.issues) console.log(`    • ${issue}`);
  }
  console.log('────────────────────────────────────────────');
}

printConfigBanner();

// On startup, clear any `researching: true` flags left behind by a prior
// crashed process. The associated idea stays in ideas/ — only the flag is
// removed so the card's "Research →" button becomes clickable again.
//
// This is the legacy Deepen-only sweep. Once Deepen migrates to the unified
// job registry (issue #84), this can be retired in favor of `sweepStaleJobs`
// below — which scans for the new `running:` flag across all stages.
(function clearStaleResearchingFlags() {
  const ideasDir = join(ROOT, 'ideas');
  if (!existsSync(ideasDir)) return;
  let cleared = 0;
  for (const entry of readdirSync(ideasDir)) {
    if (!entry.endsWith('.md')) continue;
    const fp = join(ideasDir, entry);
    const content = readFileSync(fp, 'utf8');
    const fm = parseFrontmatter(content);
    if (fm?.researching === 'true' || fm?.researching === true) {
      writeFileSync(fp, removeFrontmatterField(content, 'researching'));
      cleared++;
    }
  }
  if (cleared > 0) console.log(`[startup] Cleared ${cleared} stale researching flag(s).`);
})();

// Unified job-registry sweep. On boot, any `running:` flag still on disk
// is orphaned by definition (the in-memory registry that holds the
// AbortController is empty after restart). The age threshold guards
// against clobbering an in-flight write from another process.
//
// See src/lib/server/jobs.js and docs/ai-workflow-ux.md §8.
sweepStaleJobs();
