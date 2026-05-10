// Load .env for production (Vite handles this automatically in dev)
import 'dotenv/config';
import { describeConfig } from '$lib/server/config.js';

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
