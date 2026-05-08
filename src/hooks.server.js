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
  console.log('Atlas — provider configuration');
  console.log(`  default model  : ${fmt(d.modelDefault)}`);
  console.log(`  research model : ${fmt(d.modelResearch)}`);
  console.log(`  search backend : ${d.search.provider} ${d.search.ok ? '✓' : '✗'}`);
  console.log('  features:');
  for (const [name, ok] of Object.entries(d.features)) {
    console.log(`    ${name.padEnd(7)} ${ok ? '✓' : '✗ (unavailable — see env)'}`);
  }
  if (d.issues.length > 0) {
    console.log('  config issues:');
    for (const issue of d.issues) console.log(`    • ${issue}`);
  }
  console.log('────────────────────────────────────────────');
}

printConfigBanner();
