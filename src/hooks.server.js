// Load .env for production (Vite handles this automatically in dev)
import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync, existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { describeConfig } from '$lib/server/config.js';
import { ROOT, parseFrontmatter, removeFrontmatterField } from '$lib/server/data.js';
import { sweepStaleJobs } from '$lib/server/jobs.js';

// ── Security headers + CSRF Origin check ─────────────────────────────────────
//
// External origins required by the app:
//   connect-src : nominatim.openstreetmap.org (geocoding), router.project-osrm.org (routes),
//                 api.pexels.com (image search), tiles.stadiamaps.com (static map images),
//                 api.tavily.com / openrouter.ai / api.openai.com (AI/search — server-side only,
//                 but listed defensively)
//   img-src     : images.pexels.com (cover photos), tiles.stadiamaps.com (brochure map),
//                 *.tile.openstreetmap.org (Leaflet tiles)
//   font-src    : fonts.gstatic.com
//   style-src   : fonts.googleapis.com (CSS @import)
//   frame-src   : 'none' (no iframes)
//
// Note: Leaflet injects inline styles at runtime, so style-src needs 'unsafe-inline'.
// SvelteKit itself also injects inline scripts for hydration, requiring 'unsafe-inline'
// on script-src — or a nonce approach (not implemented here).
// To keep the app functional we ship the non-script headers now and leave a
// proper nonce-based script-src for a follow-up ticket.
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

  // Security headers
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  // Content-Security-Policy — permissive enough for Leaflet + Stadia + Pexels + OSRM + Nominatim.
  // script-src uses 'unsafe-inline' because SvelteKit injects inline hydration scripts;
  // a nonce-based approach can tighten this in a follow-up.
  // style-src uses 'unsafe-inline' because Leaflet injects inline styles at runtime.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    [
      "img-src 'self' data: blob:",
      "https://images.pexels.com",
      "https://*.tile.openstreetmap.org",
      "https://tiles.stadiamaps.com",
    ].join(' '),
    [
      "connect-src 'self'",
      "https://nominatim.openstreetmap.org",
      "https://router.project-osrm.org",
      "https://api.pexels.com",
      "https://tiles.stadiamaps.com",
    ].join(' '),
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);

  return response;
}

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
// Deferred via setImmediate so it runs on the next tick — sync I/O inside
// sweepStaleJobs would otherwise block the first incoming request.
//
// See src/lib/server/jobs.js and docs/ai-workflow-ux.md §8.
setImmediate(() => sweepStaleJobs());

// Stage dirs must be writable by the running uid; otherwise Research, Retro,
// and Archive all fail with opaque EACCES errors mid-action. Most common cause
// in Docker: a missing host bind-mount target gets auto-created by dockerd as
// root, then the container's non-root user can't write into it. Tracked
// `.gitkeep` files prevent this on fresh clones, but pre-existing installs
// (or anyone who recreated the dirs via sudo) can still hit it.
(function checkStageDirsWritable() {
  const broken = [];
  for (const stage of ['ideas', 'planning', 'completed', 'archived']) {
    const dir = join(ROOT, stage);
    if (!existsSync(dir)) continue;
    try {
      accessSync(dir, fsConstants.W_OK);
    } catch {
      broken.push(stage);
    }
  }
  if (broken.length === 0) return;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
  console.warn(`[startup] WARNING: stage dir(s) not writable by uid ${uid}: ${broken.join(', ')}`);
  console.warn(`  Research, Retro, and Archive actions will fail until this is fixed.`);
  console.warn(`  On the host, run:`);
  console.warn(`    sudo chown -R $(id -u):$(id -g) ${broken.join(' ')}`);
})();
