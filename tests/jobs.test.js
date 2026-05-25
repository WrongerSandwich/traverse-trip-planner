import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── In-memory fs mock ────────────────────────────────────────────────────────
// We model a flat key→string map. Existence is "does the key exist".
// `readdirSync(dir)` returns the immediate names whose paths have `dir/` as
// a prefix. `statSync(p)` returns {isDirectory, mtime} based on whether the
// path is a known dir or a known file.

const fs = { files: {}, dirs: new Set() };

function pathExists(p) {
  return p in fs.files || fs.dirs.has(p);
}

function ensureDir(p) {
  // Add this dir and all parent dirs so readdirSync(root) works recursively.
  let cur = p;
  while (cur && cur !== '/' && cur !== '.') {
    fs.dirs.add(cur);
    const slash = cur.lastIndexOf('/');
    if (slash <= 0) break;
    cur = cur.slice(0, slash);
  }
}

function setFile(p, content, mtimeMs = Date.now()) {
  fs.files[p] = { content, mtimeMs };
  const slash = p.lastIndexOf('/');
  if (slash > 0) ensureDir(p.slice(0, slash));
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (p) => pathExists(p),
    readFileSync: (p) => {
      if (!(p in fs.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return fs.files[p].content;
    },
    writeFileSync: (p, content) => {
      const prev = fs.files[p];
      setFile(p, content, prev?.mtimeMs ?? Date.now());
    },
    renameSync: (src, dst) => {
      if (!(src in fs.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const entry = fs.files[src];
      const prev = fs.files[dst];
      setFile(dst, entry.content, prev?.mtimeMs ?? Date.now());
      delete fs.files[src];
    },
    unlinkSync: (p) => {
      if (!(p in fs.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      delete fs.files[p];
    },
    readdirSync: (dir, opts) => {
      if (!fs.dirs.has(dir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = new Set();
      for (const p of Object.keys(fs.files)) {
        if (!p.startsWith(prefix)) continue;
        names.add(p.slice(prefix.length).split('/')[0]);
      }
      for (const d of fs.dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (!rest) continue;
        names.add(rest.split('/')[0]);
      }
      const arr = [...names];
      if (opts?.withFileTypes) {
        return arr.map(name => {
          const full = prefix + name;
          const isDir = fs.dirs.has(full);
          return {
            name,
            isFile: () => !isDir,
            isDirectory: () => isDir,
          };
        });
      }
      return arr;
    },
    statSync: (p) => {
      if (fs.files[p]) {
        return { isFile: () => true, isDirectory: () => false, mtimeMs: fs.files[p].mtimeMs };
      }
      if (fs.dirs.has(p)) {
        return { isFile: () => false, isDirectory: () => true, mtimeMs: 0 };
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdirSync: (p) => { ensureDir(p); },
  };
});

const ROOT = '/test-root';

// Stub settings so `resolveEnv` and friends don't try to read disk
vi.mock('../src/lib/server/settings.js', () => ({
  resolveEnv: () => null,
  getRuntimeSettings: () => ({}),
}));

// Use the real data.js — we want the actual frontmatter mutators.
// Override ROOT via env var (data.js uses process.cwd()).
const ORIGINAL_CWD = process.cwd;
beforeEach(() => {
  fs.files = {};
  fs.dirs = new Set();
  ensureDir(ROOT);
  ensureDir(`${ROOT}/ideas`);
  ensureDir(`${ROOT}/planning`);
  ensureDir(`${ROOT}/completed`);
  process.cwd = () => ROOT;
});

afterEach(() => {
  process.cwd = ORIGINAL_CWD;
});

// Import after the cwd mock so ROOT inside data.js / jobs.js binds to /test-root.
// Use top-level await + dynamic import inside each test? No — modules cache.
// Instead, import once and rely on the fact that data.js captures `process.cwd()`
// at module load. We need to set cwd BEFORE first import.
process.cwd = () => ROOT;

const { startJob, completeJob, failJob, cancelJob, listJobs, listRecentEvents, assertNotRunning, sweepStaleJobs, _resetForTests } = await import('../src/lib/server/jobs.js');
const { parseFrontmatter, setFrontmatterField } = await import('../src/lib/server/data.js');

function seedIdea(slug, extraFm = {}) {
  const fmLines = Object.entries({ title: slug, status: 'idea', destination: 'Anywhere', ...extraFm })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  setFile(`${ROOT}/ideas/${slug}.md`, `---\n${fmLines}\n---\n\nBody.\n`);
}

function seedPlanning(slug, extraFm = {}) {
  ensureDir(`${ROOT}/planning/${slug}`);
  const fmLines = Object.entries({ title: slug, status: 'planning', destination: 'Anywhere', ...extraFm })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  setFile(`${ROOT}/planning/${slug}/overview.md`, `---\n${fmLines}\n---\n\nBody.\n`);
}

function readIdeaFm(slug) {
  return parseFrontmatter(fs.files[`${ROOT}/ideas/${slug}.md`].content);
}

function readPlanningFm(slug) {
  return parseFrontmatter(fs.files[`${ROOT}/planning/${slug}/overview.md`].content);
}

// Read the central in-flight registry on disk. Returns `null` when the file
// doesn't exist (which is the expected steady state when no jobs are running).
function readJobsFile() {
  const entry = fs.files[`${ROOT}/.cache/.jobs.json`];
  if (!entry) return null;
  return JSON.parse(entry.content);
}

beforeEach(() => {
  _resetForTests();
  // The on-disk registry is volatile state; tests start with no in-flight jobs.
  delete fs.files[`${ROOT}/.cache/.jobs.json`];
});

// ─── startJob / completeJob happy path ───────────────────────────────────────

describe('startJob', () => {
  it('adds an entry to the in-memory map and persists it to .cache/.jobs.json', () => {
    seedIdea('marfa-tx');
    const handle = startJob('deepen', 'marfa-tx');

    expect(handle).toBeDefined();
    expect(handle.controller).toBeInstanceOf(AbortController);

    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].workflow).toBe('deepen');
    expect(jobs[0].slug).toBe('marfa-tx');
    expect(typeof jobs[0].startedAt).toBe('number');

    // Disk-side: central volatile registry — see docs/jobs-source-of-truth.md.
    const onDisk = readJobsFile();
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].workflow).toBe('deepen');
    expect(onDisk[0].slug).toBe('marfa-tx');
    expect(typeof onDisk[0].startedAt).toBe('number');
  });

  it('does not write a `running:` flag into trip frontmatter', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    // Frontmatter is no longer the source of truth for in-flight state.
    expect(readIdeaFm('marfa-tx').running).toBeUndefined();
  });

  it('persists `est_seconds` from opts when provided', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx', { est_seconds: 90 });

    const onDisk = readJobsFile();
    expect(onDisk[0].est_seconds).toBe(90);
  });

  it('works for a planning trip stored as a folder with overview.md', () => {
    seedPlanning('ozarks-loop');
    startJob('brochure', 'ozarks-loop');

    // No frontmatter mutation — registry lives in .cache/.jobs.json.
    expect(readPlanningFm('ozarks-loop').running).toBeUndefined();
    const onDisk = readJobsFile();
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].slug).toBe('ozarks-loop');
  });

  it('handles a missing trip file gracefully (in-memory entry still created)', () => {
    // No file seeded. We don't want jobs to be unstartable if the slug is wrong —
    // the in-memory map is authoritative for live state.
    const handle = startJob('deepen', 'no-such-trip');
    expect(handle).toBeDefined();
    expect(listJobs()).toHaveLength(1);
    // The central registry write doesn't depend on the trip file existing.
    expect(readJobsFile()).toHaveLength(1);
  });

  it('appends additional concurrent jobs as separate entries', () => {
    seedIdea('a');
    seedPlanning('b');
    startJob('deepen', 'a');
    startJob('brochure', 'b');

    const onDisk = readJobsFile();
    expect(onDisk).toHaveLength(2);
    const slugs = onDisk.map((e) => e.slug).sort();
    expect(slugs).toEqual(['a', 'b']);
  });
});

describe('completeJob', () => {
  it('removes the entry from the in-memory map and the on-disk registry', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    expect(listJobs()).toHaveLength(1);
    expect(readJobsFile()).toHaveLength(1);

    completeJob('deepen', 'marfa-tx', { usage: { input_tokens: 100, output_tokens: 200 } });

    expect(listJobs()).toHaveLength(0);
    // Registry empties to [] (or the file may be removed). Either way: no entries.
    const after = readJobsFile();
    expect(after === null || after.length === 0).toBe(true);
  });

  it('still writes historical `last_run_success_at` and `last_run_tokens` to frontmatter', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    completeJob('deepen', 'marfa-tx', { usage: { input_tokens: 100, output_tokens: 200 } });

    const fm = readIdeaFm('marfa-tx');
    expect(fm.last_run_success_at).toBeTruthy();
    // last_run_tokens round-trips through YAML — written as a string, re-parsed
    // back to a number. We only care that the digits are preserved.
    expect(Number(fm.last_run_tokens)).toBe(300);
    // The new-shape `running:` flag must never reappear.
    expect(fm.running).toBeUndefined();
  });

  it('clears stale `last_run_error*` fields from a previous failure on success', () => {
    seedIdea('marfa-tx', {
      last_run_error: 'provider_error',
      last_run_error_at: '2024-01-01T00:00:00Z',
      last_run_message: 'old failure',
    });
    startJob('deepen', 'marfa-tx');

    completeJob('deepen', 'marfa-tx', { tokens: 50 });

    const fm = readIdeaFm('marfa-tx');
    expect(fm.last_run_error).toBeUndefined();
    expect(fm.last_run_error_at).toBeUndefined();
    expect(fm.last_run_message).toBeUndefined();
  });

  it('is a no-op for an unknown job', () => {
    completeJob('deepen', 'never-started');
    expect(listJobs()).toHaveLength(0);
  });

  it('records tokens from { tokens } directly (spec-preferred shape)', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    completeJob('deepen', 'marfa-tx', { tokens: 400 });
    const events = listRecentEvents();
    expect(events[0].tokens).toBe(400);
  });

  it('records tokens from normalized adapter usage shape { input, output }', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    completeJob('deepen', 'marfa-tx', { usage: { input: 150, output: 250 } });
    const events = listRecentEvents();
    expect(events[0].tokens).toBe(400);
  });
});

describe('failJob', () => {
  it('removes the entry from both registries and records failure metadata', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    failJob('deepen', 'marfa-tx', { code: 'provider_error', message: 'oops' });

    expect(listJobs()).toHaveLength(0);
    const after = readJobsFile();
    expect(after === null || after.length === 0).toBe(true);
    const fm = readIdeaFm('marfa-tx');
    expect(fm.running).toBeUndefined();
    expect(fm.last_run_error).toBe('provider_error');
    expect(fm.last_run_error_at).toBeTruthy();
  });

  it('persists last_run_message to frontmatter so failures are debuggable', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    failJob('deepen', 'marfa-tx', {
      code: 'unknown',
      message: 'No overview prose returned — try again.',
    });

    const fm = readIdeaFm('marfa-tx');
    expect(fm.last_run_error).toBe('unknown');
    expect(fm.last_run_message).toBe('No overview prose returned — try again.');
  });

  it('collapses newlines and caps long messages so frontmatter stays one line', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    const long = 'first line\nsecond line\n' + 'x'.repeat(500);
    failJob('deepen', 'marfa-tx', { code: 'unknown', message: long });

    const fm = readIdeaFm('marfa-tx');
    expect(fm.last_run_message).not.toMatch(/\n/);
    expect(fm.last_run_message.length).toBeLessThanOrEqual(301);
    expect(fm.last_run_message.startsWith('first line second line')).toBe(true);
  });

  it('writes [...]‑shaped messages as quoted strings so parseFrontmatterFields reads them back as strings not arrays', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    failJob('deepen', 'marfa-tx', {
      code: 'provider_error',
      message: '[400] Bad model response',
    });

    const fm = readIdeaFm('marfa-tx');
    // Must be a string, not an array mis-parsed from YAML bracket syntax.
    // parseFrontmatterFields returns the raw trimmed value including surrounding
    // quotes, so check type and that the original content is preserved.
    expect(typeof fm.last_run_message).toBe('string');
    expect(fm.last_run_message).toContain('[400] Bad model response');
  });

  it('omits last_run_message when no message is given', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    failJob('deepen', 'marfa-tx', { code: 'cancelled' });

    const fm = readIdeaFm('marfa-tx');
    expect(fm.last_run_error).toBe('cancelled');
    expect(fm.last_run_message).toBeUndefined();
  });
});

describe('cancelJob', () => {
  it('triggers the AbortController and clears state from both registries', async () => {
    seedIdea('marfa-tx');
    const handle = startJob('deepen', 'marfa-tx');
    expect(handle.controller.signal.aborted).toBe(false);
    expect(readJobsFile()).toHaveLength(1);

    cancelJob('deepen', 'marfa-tx');

    expect(handle.controller.signal.aborted).toBe(true);
    expect(listJobs()).toHaveLength(0);
    const after = readJobsFile();
    expect(after === null || after.length === 0).toBe(true);
    expect(readIdeaFm('marfa-tx').running).toBeUndefined();
  });

  it('removes only the cancelled entry from the on-disk registry, leaving others', () => {
    seedIdea('a');
    seedIdea('b');
    startJob('deepen', 'a');
    startJob('deepen', 'b');
    expect(readJobsFile()).toHaveLength(2);

    cancelJob('deepen', 'a');

    const after = readJobsFile() ?? [];
    expect(after).toHaveLength(1);
    expect(after[0].slug).toBe('b');
  });

  it('is a no-op for an unknown job', () => {
    expect(() => cancelJob('deepen', 'never-started')).not.toThrow();
  });
});

// ─── assertNotRunning ────────────────────────────────────────────────────────

describe('assertNotRunning', () => {
  it('does not throw when no job is in flight', () => {
    expect(() => assertNotRunning('deepen', 'marfa-tx')).not.toThrow();
  });

  it('throws a TraverseError with code already_running when a duplicate is started', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    let caught;
    try {
      assertNotRunning('deepen', 'marfa-tx');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('already_running');
  });

  it('allows the same slug for a different workflow', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');

    expect(() => assertNotRunning('brochure', 'marfa-tx')).not.toThrow();
  });

  // ── Multi-instance workflows (job-key convention) ──
  // Discriminator-in-workflow lets the same trip run multiple jobs of the
  // same conceptual workflow concurrently. See src/lib/server/jobs.js header
  // and docs/ai-workflow-ux.md §6.4.

  it('treats discriminator-tagged workflows as distinct (multi-instance pattern)', () => {
    seedPlanning('ozarks-loop');
    startJob('deepen-section:stops', 'ozarks-loop');

    // Same bare workflow, different discriminator → must not collide.
    expect(() => assertNotRunning('deepen-section:route', 'ozarks-loop')).not.toThrow();

    // Same discriminator → collides.
    let caught;
    try {
      assertNotRunning('deepen-section:stops', 'ozarks-loop');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('already_running');
  });
});

// ─── listJobs shape ───────────────────────────────────────────────────────────

describe('listJobs', () => {
  it('returns plain serializable shapes (no AbortController in the snapshot)', () => {
    seedIdea('a');
    seedIdea('b');
    startJob('deepen', 'a');
    startJob('brochure', 'b');

    const snap = listJobs();
    expect(snap).toHaveLength(2);
    for (const row of snap) {
      expect(row).toHaveProperty('workflow');
      expect(row).toHaveProperty('slug');
      expect(row).toHaveProperty('startedAt');
      // Must be JSON-serializable
      expect(() => JSON.stringify(row)).not.toThrow();
      expect(row.controller).toBeUndefined();
    }
  });

  it('reads from the in-memory map, not the on-disk registry (10s poll path)', () => {
    seedIdea('a');
    startJob('deepen', 'a');

    // Delete the on-disk file out from under jobs.js. listJobs() must still
    // return the in-memory entry — disk is a recovery hint, not the live read.
    delete fs.files[`${ROOT}/.cache/.jobs.json`];

    const snap = listJobs();
    expect(snap).toHaveLength(1);
    expect(snap[0].slug).toBe('a');
  });
});

// ─── listRecentEvents ────────────────────────────────────────────────────────

describe('listRecentEvents', () => {
  it('records a success event when completeJob runs', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    completeJob('deepen', 'marfa-tx', { usage: { input_tokens: 100, output_tokens: 200 } });

    const events = listRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workflow: 'deepen',
      slug: 'marfa-tx',
      outcome: 'success',
      tokens: 300,
    });
    expect(typeof events[0].at).toBe('number');
  });

  it('records a failure event when failJob runs', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    failJob('deepen', 'marfa-tx', { code: 'provider_error', message: 'oops' });

    const events = listRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workflow: 'deepen',
      slug: 'marfa-tx',
      outcome: 'failure',
      code: 'provider_error',
    });
  });

  it('records a cancellation event when cancelJob runs', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    cancelJob('deepen', 'marfa-tx');

    const events = listRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workflow: 'deepen',
      slug: 'marfa-tx',
      outcome: 'failure',
      code: 'cancelled',
    });
  });

  it('prunes events older than the TTL (default 60s)', () => {
    seedIdea('marfa-tx');
    startJob('deepen', 'marfa-tx');
    completeJob('deepen', 'marfa-tx', {});

    const originalNow = Date.now;
    try {
      // Advance 90s
      Date.now = () => originalNow() + 90 * 1000;
      expect(listRecentEvents()).toHaveLength(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it('keeps multiple events in chronological order', () => {
    seedIdea('a');
    seedIdea('b');
    startJob('deepen', 'a');
    completeJob('deepen', 'a', {});
    startJob('brochure', 'b');
    failJob('brochure', 'b', { code: 'timeout' });

    const events = listRecentEvents();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.slug)).toEqual(['a', 'b']);
  });
});

// ─── sweepStaleJobs ──────────────────────────────────────────────────────────
//
// New shape (post-#377): the sweep reads `.cache/.jobs.json`, marks each
// listed trip's frontmatter with `last_run_error: 'interrupted'` + timestamp +
// message, then deletes the registry file. A one-release-cycle legacy scan
// also walks the stage dirs for any pre-#375 `running:` flag and applies the
// same triple. No age threshold — a single-instance Node server can't race
// itself, and the sweep runs before any request is served. See
// docs/jobs-source-of-truth.md.

describe('sweepStaleJobs', () => {
  /** Write a fake registry to `.cache/.jobs.json` as if the previous boot
   *  had jobs in flight when the process died. */
  function seedRegistry(entries) {
    setFile(`${ROOT}/.cache/.jobs.json`, JSON.stringify(entries, null, 2));
  }

  it('reads .cache/.jobs.json and writes the interrupted triple to each listed trip', () => {
    seedIdea('marfa-tx');
    seedPlanning('ozarks-loop');
    seedRegistry([
      { workflow: 'deepen', slug: 'marfa-tx', startedAt: 1700000000000 },
      { workflow: 'brochure', slug: 'ozarks-loop', startedAt: 1700000000000 },
    ]);

    const result = sweepStaleJobs();
    expect(result.fromRegistry).toBe(2);

    const idea = readIdeaFm('marfa-tx');
    expect(idea.last_run_error).toBe('interrupted');
    expect(idea.last_run_error_at).toBeTruthy();
    expect(idea.last_run_message).toContain('Server restarted mid-job.');

    const plan = readPlanningFm('ozarks-loop');
    expect(plan.last_run_error).toBe('interrupted');
    expect(plan.last_run_error_at).toBeTruthy();
    expect(plan.last_run_message).toContain('Server restarted mid-job.');
  });

  it('deletes .cache/.jobs.json after a successful sweep pass', () => {
    seedIdea('marfa-tx');
    seedRegistry([{ workflow: 'deepen', slug: 'marfa-tx', startedAt: 1 }]);
    expect(readJobsFile()).toHaveLength(1);

    sweepStaleJobs();

    expect(readJobsFile()).toBeNull();
  });

  it('is a no-op when .cache/.jobs.json is absent and no legacy flags exist', () => {
    seedIdea('clean-idea');

    const result = sweepStaleJobs();
    expect(result.fromRegistry).toBe(0);
    expect(result.fromLegacy).toBe(0);
  });

  it('skips registry entries whose trip file no longer exists (and still deletes the file)', () => {
    seedRegistry([{ workflow: 'deepen', slug: 'ghost-trip', startedAt: 1 }]);

    const result = sweepStaleJobs();
    // Counts only entries we actually wrote frontmatter for.
    expect(result.fromRegistry).toBe(0);
    expect(readJobsFile()).toBeNull();
  });

  // ── Legacy scan: drain `running:` flags from pre-#375 installs ──

  it('legacy scan removes a `running:` flag and writes the interrupted triple', () => {
    seedIdea('legacy-idea', { running: 'deepen' });

    const result = sweepStaleJobs();
    expect(result.fromLegacy).toBe(1);

    const fm = readIdeaFm('legacy-idea');
    expect(fm.running).toBeUndefined();
    expect(fm.last_run_error).toBe('interrupted');
    expect(fm.last_run_error_at).toBeTruthy();
    expect(fm.last_run_message).toContain('Server restarted mid-job.');
  });

  it('legacy scan covers planning-stage overview.md', () => {
    seedPlanning('legacy-plan', { running: 'brochure' });

    const result = sweepStaleJobs();
    expect(result.fromLegacy).toBe(1);

    const fm = readPlanningFm('legacy-plan');
    expect(fm.running).toBeUndefined();
    expect(fm.last_run_error).toBe('interrupted');
  });

  it('legacy scan ignores files that have no `running:` flag', () => {
    seedIdea('idle-idea');

    const result = sweepStaleJobs();
    expect(result.fromLegacy).toBe(0);

    expect(readIdeaFm('idle-idea').running).toBeUndefined();
    expect(readIdeaFm('idle-idea').last_run_error).toBeUndefined();
  });

  it('runs the legacy scan even when no .cache/.jobs.json is present', () => {
    seedIdea('legacy-only', { running: 'deepen' });
    // No registry file seeded.

    const result = sweepStaleJobs();
    expect(result.fromRegistry).toBe(0);
    expect(result.fromLegacy).toBe(1);
  });

  it('no longer accepts a maxAgeMinutes parameter (no-op if passed; sweeps unconditionally)', () => {
    // Pre-#377 callers passed { maxAgeMinutes }. The parameter is gone; the
    // sweep is unconditional now. We assert by passing a fresh `running:` flag
    // (mtime ≈ now) that the old code would have spared — it must now be cleared.
    seedIdea('fresh-flag', { running: 'deepen' });

    const result = sweepStaleJobs();
    expect(result.fromLegacy).toBe(1);
    expect(readIdeaFm('fresh-flag').running).toBeUndefined();
  });

  it('logs a single line with split counts (from registry vs. legacy frontmatter)', () => {
    seedIdea('marfa-tx');
    seedIdea('legacy-idea', { running: 'deepen' });
    seedRegistry([{ workflow: 'deepen', slug: 'marfa-tx', startedAt: 1 }]);

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      sweepStaleJobs();
    } finally {
      console.log = originalLog;
    }

    // One boot log line, with both counts visible.
    const sweepLines = logs.filter((l) => l.includes('[jobs] sweep'));
    expect(sweepLines).toHaveLength(1);
    expect(sweepLines[0]).toMatch(/registry/);
    expect(sweepLines[0]).toMatch(/legacy/);
    expect(sweepLines[0]).toMatch(/1/);
  });

  it('does not log when there is nothing to sweep', () => {
    seedIdea('clean-idea');

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      sweepStaleJobs();
    } finally {
      console.log = originalLog;
    }

    expect(logs.filter((l) => l.includes('[jobs] sweep'))).toHaveLength(0);
  });
});
