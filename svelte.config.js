import adapter from '@sveltejs/adapter-node';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Compute sha256 hashes of every inline <script> block in src/app.html so
// they can be added to script-src without 'unsafe-inline'. SvelteKit's csp
// processor hashes its OWN injected hydration scripts but ignores the
// static <script> tags in app.html — those need to be hashed here.
//
// The hashes auto-update when app.html changes; tests/svelte-config.test.js
// pins the directive shape so a missed re-hash fails CI.
const APP_HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), 'src/app.html');
const appHtml = readFileSync(APP_HTML_PATH, 'utf8');
const APP_HTML_SCRIPT_HASHES = [...appHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);

export default {
  kit: {
    adapter: adapter(),

    // Content-Security-Policy (issue #426). Owned here rather than in
    // hooks.server.js so SvelteKit can hash every inline script — the
    // app.html theme bootstrap and SvelteKit's own hydration scripts —
    // without falling back to 'unsafe-inline' on script-src.
    //
    // Mode 'hash': SvelteKit computes a sha256 for the hydration script it
    // injects and adds it to script-src. The hashes above cover the static
    // app.html bootstrap. Together they replace 'unsafe-inline' entirely.
    //
    // SvelteKit sets the Content-Security-Policy HTTP header itself on HTML
    // responses (and injects a matching <meta http-equiv> tag). Non-HTML
    // responses (JSON API endpoints, SSE streams) receive no CSP — there's
    // nothing for the browser to execute in those responses.
    //
    // style-src keeps 'unsafe-inline' because Leaflet injects styles at
    // runtime and SvelteKit emits inline CSS for hot-reloaded components;
    // hashing those statically is not feasible. Tightening style-src is
    // tracked separately if it becomes worthwhile.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...APP_HTML_SCRIPT_HASHES],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': [
          "'self'",
          'data:',
          'blob:',
          'https://images.pexels.com',
          'https://*.tile.openstreetmap.org',
          'https://tiles.stadiamaps.com',
        ],
        'connect-src': [
          "'self'",
          'https://nominatim.openstreetmap.org',
          'https://router.project-osrm.org',
          'https://api.pexels.com',
          'https://tiles.stadiamaps.com',
        ],
        'frame-src': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
      },
    },
  },
};
