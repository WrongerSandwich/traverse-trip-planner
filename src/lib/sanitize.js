/**
 * Shared markdown → safe HTML helper.
 *
 * Runs marked.parse() then pipes the result through DOMPurify so that
 * {@html …} bindings in Svelte components don't expose XSS vectors from
 * LLM-generated content or user-authored trip markdown.
 *
 * DOMPurify's default allowlist permits all normal formatting elements
 * (headings, lists, links, emphasis, code, blockquote, tables, images)
 * while stripping script tags, event handlers, and javascript: URLs.
 */

import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Parse markdown and sanitize the resulting HTML.
 * @param {string | null | undefined} md - Raw markdown string.
 * @returns {string} Sanitized HTML safe to bind with {@html …}.
 */
export function renderMarkdown(md) {
  const raw = marked.parse(md || '', { mangle: false, headerIds: false });
  const clean = DOMPurify.sanitize(raw);
  // Wrap tables in a scroll container so wide markdown tables (e.g. the
  // reservations / planning table in logistics.md) overflow horizontally
  // on narrow viewports instead of compressing cells to unreadable widths.
  // Done after sanitize so the wrapper is a fixed string, not user input.
  return clean
    .replace(/<table>/g, '<div class="md-table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
}
