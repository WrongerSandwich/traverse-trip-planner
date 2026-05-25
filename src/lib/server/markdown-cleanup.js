/**
 * Deterministic markdown cleanup for LLM-generated section content.
 *
 * Used after parsing the model's XML-wrapped output (e.g. <route_md>...</route_md>)
 * and before writing to disk. Handles the mechanical formatting issues that
 * tend to leak through even with explicit prompt rules — the kinds of fixes
 * a model can't reliably self-review for. Leaves semantic structure
 * (heading hierarchy, list nesting, table layout) entirely alone.
 *
 * Applied to: deepen, deepen-section. Single export to keep the call site
 * obvious.
 *
 * @param {string} raw - the model's section markdown
 * @returns {string} - cleaned markdown
 */
export function cleanupLLMMarkdown(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw;

  // 1. Strip an outer ``` or ```markdown / ```md / ```mdx fence that wraps
  //    the whole output. The model sometimes wraps its entire response in
  //    a code fence even when we told it not to.
  s = s.trim();
  const fenceMatch = s.match(/^```(?:markdown|md|mdx)?\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch) s = fenceMatch[1];

  // 2. Normalize line endings.
  s = s.replace(/\r\n?/g, '\n');

  // 3. Strip trailing whitespace per line. Spec-compliant markdown uses
  //    trailing double-spaces for hard breaks, but LLM output essentially
  //    never relies on that — strip everything trailing to keep diffs
  //    clean and prevent invisible characters from accumulating.
  s = s.split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n');

  // 4. Normalize bullet characters. Convert `*` and `+` bullets to `-` so
  //    a single section doesn't mix styles. Only touch lines whose first
  //    non-whitespace token is one of those bullets followed by a space —
  //    don't catch `*emphasis*` or `+1` etc.
  s = s.replace(/^(\s*)[*+](\s)/gm, '$1-$2');

  // 5. Collapse runs of 3+ consecutive blank lines to 2. Markdown only
  //    needs one blank between blocks; LLMs sometimes emit 3-5 in a row
  //    around heading sections. Two blanks is generous breathing room.
  s = s.replace(/\n{3,}/g, '\n\n');

  // 6. Ensure a blank line before any ATX heading that doesn't have one
  //    (mid-paragraph headings render correctly in most renderers but
  //    look messy in source diffs).
  s = s.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');

  // 7. Final trim — no leading or trailing blank lines on the file
  //    itself; atomicWrite appends its own single newline.
  s = s.replace(/^\n+/, '').replace(/\n+$/, '');

  return s;
}
