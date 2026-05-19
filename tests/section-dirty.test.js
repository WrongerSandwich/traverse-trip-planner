import { describe, it, expect } from 'vitest';
import { isSectionsDirty } from '../src/lib/utils/sectionDirty.js';

describe('isSectionsDirty', () => {
  it('returns false when drafts is empty', () => {
    expect(isSectionsDirty({}, { overview: 'some content' })).toBe(false);
  });

  it('returns false when all drafts match saved sections', () => {
    const sections = { overview: '# Overview\nContent here', route: '# Route\nDetails' };
    const drafts = { overview: '# Overview\nContent here', route: '# Route\nDetails' };
    expect(isSectionsDirty(drafts, sections)).toBe(false);
  });

  it('returns true when a draft differs from its saved section', () => {
    const sections = { overview: 'original text' };
    const drafts = { overview: 'modified text' };
    expect(isSectionsDirty(drafts, sections)).toBe(true);
  });

  it('returns true when one draft differs even if others match', () => {
    const sections = { overview: 'original', route: 'route content' };
    const drafts = { overview: 'original', route: 'different route content' };
    expect(isSectionsDirty(drafts, sections)).toBe(true);
  });

  it('returns false when a draft matches a section that is an empty string', () => {
    const sections = { overview: '' };
    const drafts = { overview: '' };
    expect(isSectionsDirty(drafts, sections)).toBe(false);
  });

  it('returns false when a draft is empty string and section is undefined (new section)', () => {
    // sections[section] ?? '' means undefined maps to '' — draft '' equals ''
    const sections = {};
    const drafts = { overview: '' };
    expect(isSectionsDirty(drafts, sections)).toBe(false);
  });

  it('returns true when a draft has content but section is undefined (new section)', () => {
    const sections = {};
    const drafts = { overview: 'New content typed by user' };
    expect(isSectionsDirty(drafts, sections)).toBe(true);
  });

  it('returns false after cancelEdit pattern (draft reset to saved value then deleted)', () => {
    // Simulate what cancelEdit does: draft is set to saved value, then deleted
    const sections = { overview: 'original' };
    const drafts = {}; // draft was deleted
    expect(isSectionsDirty(drafts, sections)).toBe(false);
  });

  it('returns false after saveEdit pattern (draft deleted, sections updated)', () => {
    const sections = { overview: 'saved new value' };
    const drafts = {}; // draft deleted after successful save
    expect(isSectionsDirty(drafts, sections)).toBe(false);
  });
});
