// Load .env for production (Vite handles this automatically in dev)
import 'dotenv/config';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { describeConfig } from '$lib/server/config.js';
import { DATA_DIR } from '$lib/server/data.js';
import { sweepStaleJobs } from '$lib/server/jobs.js';

// ── Security headers + CSRF Origin check ─────────────────────────────────────
//
// Content-Security-Policy is owned by SvelteKit's `kit.csp` config in
// svelte.config.js (issue #426) so per-request nonces / hashes can replace
// the old `'unsafe-inline'` on script-src. SvelteKit emits the CSP header
// itself on HTML responses; this file no longer sets it. Other security
// headers (X-Frame-Options, etc.) are still applied here on every response.
export async function handle({ event, resolve }) {
  const { request, url } = event;

  // CSRF Origin check: reject cross-origin non-GET/HEAD requests to /api/*
  if (
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    url.pathname.startsWith('/api/')
  ) {
    const origin = request.headers.get('origin');
    if (origin !== null) {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        return new Response('Forbidden', { status: 403 });
      }
      if (originHost !== url.host) {
        return new Response('Forbidden', { status: 403 });
      }
    }
  }

  const response = await resolve(event);

  // Security headers (CSP is set by SvelteKit on HTML responses — see
  // svelte.config.js).
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  return response;
}

let banneredOnce = false;

function printConfigBanner() {
  if (banneredOnce) return;
  banneredOnce = true;

  const d = describeConfig();

  // Render a per-slot source label: "[.env]" / "[settings.json]" / "[default]"
  // when both provider and model agree, otherwise "[provider:.env, model:settings.json]".
  // SOURCE_LABEL maps the source code to the human-readable label so the source
  // attribution can be widened later (e.g. adding a "shell" source) without
  // touching every call site.
  const SOURCE_LABEL = { env: '.env', settings: 'settings.json', default: 'default' };
  const slotSource = (s) => {
    if (s.providerSource === s.modelSource) return `[${SOURCE_LABEL[s.providerSource]}]`;
    return `[provider:${SOURCE_LABEL[s.providerSource]}, model:${SOURCE_LABEL[s.modelSource]}]`;
  };
  const fmt = (slot) => `${slot.provider}/${slot.model} ${slot.ok ? '✓' : '✗'} ${slotSource(slot)}`;

  console.log('────────────────────────────────────────────');
  console.log('Traverse — provider configuration');
  console.log(`  default model  : ${fmt(d.modelDefault)}`);
  console.log(`  research model : ${fmt(d.modelResearch)}`);
  console.log(`  search backend : ${d.search.provider} ${d.search.ok ? '✓' : '✗'} [${SOURCE_LABEL[d.search.providerSource]}]`);
  console.log('  features:');
  for (const [name, info] of Object.entries(d.features)) {
    const status = info.ok ? '✓' : '✗';
    const detail = `${info.provider}/${info.model}${info.overridden ? ' (override)' : ''}`;
    const tail = info.ok ? '' : ' (unavailable — configure in .env or /configuration)';
    console.log(`    ${name.padEnd(7)} ${status} ${detail}${tail}`);
  }
  if (d.issues.length > 0) {
    console.log('  config issues:');
    for (const issue of d.issues) console.log(`    • ${issue}`);
  }
  console.log('────────────────────────────────────────────');
}

printConfigBanner();

// Unified job-registry sweep. On boot, any entry in `.cache/.jobs.json` or
// any `running:` flag still on disk is orphaned by definition (the in-memory
// registry that holds the AbortController is empty after restart). No age
// threshold needed — a single-instance Node server can't race itself, and
// this runs before any request is served.
//
// Deferred via setImmediate so it runs on the next tick — sync I/O inside
// sweepStaleJobs would otherwise block the first incoming request.
//
// See src/lib/server/jobs.js, docs/jobs-source-of-truth.md, and
// docs/ai-workflow-ux.md §8.
setImmediate(() => sweepStaleJobs());

// Stage dirs must be writable by the running uid; otherwise Research, Retro,
// and Archive all fail with opaque EACCES errors mid-action. Most common cause
// in Docker: a missing host bind-mount target gets auto-created by dockerd as
// root, then the container's non-root user can't write into it. The tracked
// `data/.gitkeep` prevents this on fresh clones, but pre-existing installs
// (or anyone who recreated the dirs via sudo) can still hit it.
(function checkStageDirsWritable() {
  const broken = [];
  for (const stage of ['ideas', 'planning', 'completed', 'archived']) {
    const dir = join(DATA_DIR, stage);
    if (!existsSync(dir)) continue;
    try {
      accessSync(dir, fsConstants.W_OK);
    } catch {
      broken.push(stage);
    }
  }
  if (broken.length === 0) return;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
  console.warn(`[startup] WARNING: data/<stage> dir(s) not writable by uid ${uid}: ${broken.join(', ')}`);
  console.warn(`  Research, Retro, and Archive actions will fail until this is fixed.`);
  console.warn(`  On the host, run:`);
  console.warn(`    sudo chown -R $(id -u):$(id -g) data`);
})();
