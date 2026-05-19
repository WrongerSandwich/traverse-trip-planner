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
  return DOMPurify.sanitize(raw);
}
