import { describe, it, expect } from 'vitest';
import config from '../svelte.config.js';

// CSP is owned by SvelteKit's `kit.csp` config (issue #426) so it can emit
// per-request nonces / hashes for inline scripts without falling back to
// `'unsafe-inline'` on script-src. These tests pin the directive shape so a
// silent loosening of the policy (e.g. someone re-adding `'unsafe-inline'`
// to make a debug session easier) fails CI.

describe('svelte.config.js — CSP', () => {
  const csp = config.kit?.csp;

  it('declares a csp config block on kit', () => {
    expect(csp).toBeDefined();
    expect(csp.directives).toBeDefined();
  });

  it("does NOT include 'unsafe-inline' in script-src (hardening goal of #426)", () => {
    expect(csp.directives['script-src']).not.toContain("'unsafe-inline'");
  });

  it("includes 'self' in script-src", () => {
    expect(csp.directives['script-src']).toContain("'self'");
  });

  it('includes a sha256 hash for each inline script in app.html', () => {
    // Hashes are extracted at config-load time via fs.readFileSync — if the
    // regex breaks (e.g. someone reformats app.html into a shape the parser
    // misses) the script-src would collapse to just ["'self'"] and the
    // inline theme bootstrap would be CSP-blocked at runtime.
    const hashes = csp.directives['script-src'].filter((v) => v.startsWith("'sha256-"));
    expect(hashes.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps 'unsafe-inline' in style-src (Leaflet/SvelteKit inline styles)", () => {
    // Tightening style-src is out of scope for this ticket. Inline styles
    // from Leaflet runtime + SvelteKit's CSS injection cannot be hashed
    // statically; leaving 'unsafe-inline' here is the documented trade-off.
    expect(csp.directives['style-src']).toContain("'unsafe-inline'");
  });

  it('allows image hosts the app actually uses', () => {
    const imgSrc = csp.directives['img-src'];
    expect(imgSrc).toContain('https://images.pexels.com');
    expect(imgSrc).toContain('https://tiles.stadiamaps.com');
    expect(imgSrc).toContain('https://*.tile.openstreetmap.org');
  });

  it('allows connect hosts the app actually uses', () => {
    const connectSrc = csp.directives['connect-src'];
    expect(connectSrc).toContain('https://nominatim.openstreetmap.org');
    expect(connectSrc).toContain('https://router.project-osrm.org');
    expect(connectSrc).toContain('https://api.pexels.com');
    expect(connectSrc).toContain('https://tiles.stadiamaps.com');
  });

  it("blocks frames (frame-src 'none')", () => {
    expect(csp.directives['frame-src']).toEqual(["'none'"]);
  });

  it("blocks object embeds (object-src 'none')", () => {
    expect(csp.directives['object-src']).toEqual(["'none'"]);
  });

  it("restricts base-uri to 'self'", () => {
    expect(csp.directives['base-uri']).toEqual(["'self'"]);
  });
});
