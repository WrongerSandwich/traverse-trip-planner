import { describe, it, expect } from 'vitest';
import {
  isValidSlug,
  rejectInvalidSlug,
  isValidCandidateId,
  rejectInvalidId,
  isSafeIdeaPath,
  assertSafeIdeaPath,
} from '../src/lib/server/data.js';

describe('isValidSlug', () => {
  it('accepts normal kebab-case slugs', () => {
    expect(isValidSlug('glacier-loop')).toBe(true);
    expect(isValidSlug('ozarks')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('hannibal-twain-2026')).toBe(true);
    expect(isValidSlug('trip-with-many-words-in-the-slug')).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    expect(isValidSlug('..')).toBe(false);
    expect(isValidSlug('../../etc/passwd')).toBe(false);
    expect(isValidSlug('../home')).toBe(false);
    expect(isValidSlug('trip/../other')).toBe(false);
    // SvelteKit URL-decodes %-encoded chars before routing, so a request to
    // /api/trip/%2e%2e%2fhome surfaces here as slug='..%/home' or similar —
    // either way, the / and dots fail the allowlist.
    expect(isValidSlug('..%2f..%2fhome.md')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isValidSlug('/etc/passwd')).toBe(false);
    expect(isValidSlug('/home')).toBe(false);
  });

  it('rejects leading/trailing/internal slashes', () => {
    expect(isValidSlug('foo/bar')).toBe(false);
    expect(isValidSlug('/foo')).toBe(false);
    expect(isValidSlug('foo/')).toBe(false);
  });

  it('rejects null bytes and weird whitespace', () => {
    expect(isValidSlug('foo\0bar')).toBe(false);
    expect(isValidSlug('foo bar')).toBe(false);
    expect(isValidSlug('foo\nbar')).toBe(false);
    expect(isValidSlug('foo\tbar')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidSlug('Glacier-Loop')).toBe(false);
    expect(isValidSlug('FOO')).toBe(false);
  });

  it('rejects leading dash, underscores, dots', () => {
    expect(isValidSlug('-foo')).toBe(false);
    expect(isValidSlug('foo_bar')).toBe(false);
    expect(isValidSlug('foo.bar')).toBe(false);
    expect(isValidSlug('foo.md')).toBe(false);
  });

  it('rejects empty / non-string', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug(null)).toBe(false);
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(42)).toBe(false);
    expect(isValidSlug({})).toBe(false);
  });

  it('rejects overly long slugs', () => {
    expect(isValidSlug('a'.repeat(200))).toBe(false);
  });

  it('accepts a slug right at the length cap', () => {
    expect(isValidSlug('a'.repeat(100))).toBe(true);
    expect(isValidSlug('a'.repeat(101))).toBe(false);
  });
});

describe('rejectInvalidSlug', () => {
  it('returns null for a valid slug', () => {
    expect(rejectInvalidSlug('glacier-loop')).toBeNull();
  });

  it('returns a 400 Response for an invalid slug', async () => {
    const res = rejectInvalidSlug('../etc/passwd');
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid/i);
  });

  it('returns 400 for non-string input', () => {
    const res = rejectInvalidSlug(undefined);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
  });
});

describe('isValidCandidateId / rejectInvalidId', () => {
  // Candidate / stop / lodging / todo ids are minted by makeCandidateId() —
  // kebab-case ASCII with an optional `-N` suffix, fallback `candidate` (#496).
  it('accepts well-formed candidate ids', () => {
    expect(isValidCandidateId('lake-mcdonald')).toBe(true);
    expect(isValidCandidateId('lake-mcdonald-2')).toBe(true);
    expect(isValidCandidateId('candidate')).toBe(true);
    expect(isValidCandidateId('a')).toBe(true);
    expect(isValidCandidateId('a'.repeat(200))).toBe(true); // generous cap for long names
  });

  it('rejects traversal / path / regex-shaped ids', () => {
    expect(isValidCandidateId('../../home')).toBe(false);
    expect(isValidCandidateId('foo/bar')).toBe(false);
    expect(isValidCandidateId('/etc/passwd')).toBe(false);
    expect(isValidCandidateId('lake..mcdonald')).toBe(false);
    expect(isValidCandidateId('.*')).toBe(false);
  });

  it('rejects uppercase, whitespace, null bytes, leading dash, empty / non-string', () => {
    expect(isValidCandidateId('Lake-McDonald')).toBe(false);
    expect(isValidCandidateId('lake mcdonald')).toBe(false);
    expect(isValidCandidateId('lake\0mcdonald')).toBe(false);
    expect(isValidCandidateId('-lake')).toBe(false);
    expect(isValidCandidateId('')).toBe(false);
    expect(isValidCandidateId(null)).toBe(false);
    expect(isValidCandidateId(undefined)).toBe(false);
    expect(isValidCandidateId(42)).toBe(false);
  });

  it('rejects ids past the (generous) length cap', () => {
    expect(isValidCandidateId('a'.repeat(201))).toBe(false);
  });

  it('rejectInvalidId returns null for a valid id and 400 otherwise', async () => {
    expect(rejectInvalidId('lake-mcdonald')).toBeNull();
    const res = rejectInvalidId('../../home');
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid/i);
  });
});

describe('isSafeIdeaPath / assertSafeIdeaPath', () => {
  it('accepts ideas/<kebab>.md paths', () => {
    expect(isSafeIdeaPath('ideas/glacier-loop.md')).toBe(true);
    expect(isSafeIdeaPath('ideas/a.md')).toBe(true);
    expect(isSafeIdeaPath('ideas/trip-2026.md')).toBe(true);
  });

  it('rejects traversal sequences', () => {
    expect(isSafeIdeaPath('../../.env')).toBe(false);
    expect(isSafeIdeaPath('ideas/../home.md')).toBe(false);
    expect(isSafeIdeaPath('ideas/../../etc/passwd')).toBe(false);
  });

  it('rejects paths outside ideas/', () => {
    expect(isSafeIdeaPath('planning/foo.md')).toBe(false);
    expect(isSafeIdeaPath('home.md')).toBe(false);
    expect(isSafeIdeaPath('/ideas/foo.md')).toBe(false);
  });

  it('rejects missing .md extension', () => {
    expect(isSafeIdeaPath('ideas/foo')).toBe(false);
    expect(isSafeIdeaPath('ideas/foo.txt')).toBe(false);
    expect(isSafeIdeaPath('ideas/foo.md.bak')).toBe(false);
  });

  it('rejects subdirectories under ideas/', () => {
    expect(isSafeIdeaPath('ideas/sub/foo.md')).toBe(false);
  });

  it('rejects uppercase in the filename', () => {
    expect(isSafeIdeaPath('ideas/Foo.md')).toBe(false);
    expect(isSafeIdeaPath('ideas/FOO.md')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeIdeaPath(null)).toBe(false);
    expect(isSafeIdeaPath(undefined)).toBe(false);
    expect(isSafeIdeaPath(42)).toBe(false);
  });

  it('assertSafeIdeaPath throws on unsafe input', () => {
    expect(() => assertSafeIdeaPath('../../.env')).toThrow(/unsafe/i);
    expect(() => assertSafeIdeaPath('home.md')).toThrow();
  });

  it('assertSafeIdeaPath returns the path on success', () => {
    expect(assertSafeIdeaPath('ideas/foo.md')).toBe('ideas/foo.md');
  });
});

describe('frontmatter field setters — regex escape', () => {
  // Internal-only API; this test just confirms metacharacters in field names
  // do not crash or mangle output. We don't pass user input there, but the
  // belt-and-suspenders escape protects against typos.
  it('does not blow up when given a field name with regex metacharacters', async () => {
    const { setFrontmatterField, removeFrontmatterField } = await import('../src/lib/server/data.js');
    const original = '---\ntitle: Hello\n---\nbody';
    // A dot in a field name would normally match any char in regex; the
    // escape ensures it's treated literally.
    const set = setFrontmatterField(original, 'foo.bar', 'baz');
    expect(set).toContain('foo.bar: baz');
    const removed = removeFrontmatterField(set, 'foo.bar');
    expect(removed).not.toContain('foo.bar');
    // Title should still be there
    expect(removed).toContain('title: Hello');
  });
});
