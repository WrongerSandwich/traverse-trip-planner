import { describe, it, expect } from 'vitest';
import { cleanupLLMMarkdown } from '../src/lib/server/markdown-cleanup.js';

describe('cleanupLLMMarkdown', () => {
  it('passes well-formed markdown through unchanged', () => {
    const input = `## Heading\n\nA paragraph.\n\n- bullet one\n- bullet two`;
    expect(cleanupLLMMarkdown(input)).toBe(input);
  });

  it('strips an outer ```markdown fence wrapping the entire output', () => {
    const input = '```markdown\n## Heading\n\nBody.\n```';
    expect(cleanupLLMMarkdown(input)).toBe('## Heading\n\nBody.');
  });

  it('strips an outer bare ``` fence wrapping the entire output', () => {
    const input = '```\n## Heading\n\nBody.\n```';
    expect(cleanupLLMMarkdown(input)).toBe('## Heading\n\nBody.');
  });

  it('leaves inline fenced code blocks intact', () => {
    const input = '## Code\n\n```js\nconst x = 1;\n```\n\nDone.';
    expect(cleanupLLMMarkdown(input)).toBe(input);
  });

  it('normalizes line endings to LF', () => {
    const input = 'line one\r\nline two\r\nline three';
    expect(cleanupLLMMarkdown(input)).toBe('line one\nline two\nline three');
  });

  it('strips trailing whitespace from every line', () => {
    const input = 'first line   \nsecond line\t\t\nthird line';
    expect(cleanupLLMMarkdown(input)).toBe('first line\nsecond line\nthird line');
  });

  it('normalizes * and + bullets to -', () => {
    const input = `* one\n* two\n+ three\n  * nested\n  + nested+`;
    const out = cleanupLLMMarkdown(input);
    expect(out).toBe(`- one\n- two\n- three\n  - nested\n  - nested+`);
  });

  it('leaves emphasis and +1 alone (no bullet at line start)', () => {
    const input = `Some *emphasis* and a +1 vote.`;
    expect(cleanupLLMMarkdown(input)).toBe(input);
  });

  it('collapses 3+ blank-line runs to 2', () => {
    const input = `## A\n\n\n\n## B\n\n\nbody`;
    expect(cleanupLLMMarkdown(input)).toBe(`## A\n\n## B\n\nbody`);
  });

  it('inserts a blank line before a heading that lacks one', () => {
    const input = `Closing line of paragraph.\n## Next Section\n\nBody.`;
    expect(cleanupLLMMarkdown(input)).toBe(`Closing line of paragraph.\n\n## Next Section\n\nBody.`);
  });

  it('strips leading and trailing blank lines', () => {
    const input = `\n\n## Heading\n\nBody.\n\n\n`;
    expect(cleanupLLMMarkdown(input)).toBe(`## Heading\n\nBody.`);
  });

  it('combines multiple fixes in one pass', () => {
    const input = `\`\`\`markdown\n\n\n## Heading   \n\n\n\n* one  \n* two\nNext paragraph\n## Without blank\n\nBody.\n\n\n\`\`\`\n`;
    const out = cleanupLLMMarkdown(input);
    expect(out).toBe(`## Heading\n\n- one\n- two\nNext paragraph\n\n## Without blank\n\nBody.`);
  });

  it('handles non-string input safely', () => {
    expect(cleanupLLMMarkdown(null)).toBe('');
    expect(cleanupLLMMarkdown(undefined)).toBe('');
    expect(cleanupLLMMarkdown(42)).toBe('');
  });

  it('handles empty input', () => {
    expect(cleanupLLMMarkdown('')).toBe('');
    expect(cleanupLLMMarkdown('   \n\n   ')).toBe('');
  });
});
