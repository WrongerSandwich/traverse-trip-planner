/**
 * Core array-level diff via longest-common-subsequence (LCS). The DP table
 * costs O(m·n) memory; the planning sections we diff are typically <500
 * elements, so we're well under a megabyte and a few milliseconds.
 *
 * Callers pre-split the two strings into the token granularity they need:
 *   - `diffLines` for monospace per-line diffs (e.g., the old Preview block)
 *   - `diffBlocks` for paragraph-level diffs against markdown content
 *
 * Returns rows tagged with the original element under `.line` (kept for
 * back-compat with the existing `diffLines` consumers — paragraph-level
 * consumers also read `.line`, treating it as "the chunk that changed").
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<{ type: 'eq' | 'add' | 'del', line: string }>}
 */
export function diffArrays(a, b) {
  const m = a.length;
  const n = b.length;

  // Bottom-up LCS table; dp[i][j] = length of LCS of a[i..] and b[j..].
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk forward emitting an edit script.
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', line: a[i] });
      i++;
    } else {
      out.push({ type: 'add', line: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: 'del', line: a[i++] });
  while (j < n) out.push({ type: 'add', line: b[j++] });
  return out;
}

/**
 * Line-level diff. Kept as the public API for callers that want monospace
 * per-line output (e.g., the legacy in-panel Preview block).
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ type: 'eq' | 'add' | 'del', line: string }>}
 */
export function diffLines(before, after) {
  return diffArrays((before ?? '').split('\n'), (after ?? '').split('\n'));
}

/**
 * Paragraph-level diff. Splits each string into blocks delimited by blank
 * lines (one or more `\n` runs) — the standard markdown paragraph break.
 * Each surviving row's `.line` is a full markdown block that can be passed
 * to `renderMarkdown()` for in-section overlay rendering.
 *
 * Empty trailing blocks (from a final `\n\n`) are dropped so they don't
 * register as spurious adds/dels.
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ type: 'eq' | 'add' | 'del', line: string }>}
 */
export function diffBlocks(before, after) {
  const splitBlocks = (s) =>
    (s ?? '')
      .split(/\n{2,}/)
      .map((b) => b.replace(/\s+$/, ''))
      .filter((b) => b.length > 0);
  return diffArrays(splitBlocks(before), splitBlocks(after));
}

/**
 * Trim an LCS-style diff to just the changed regions plus a small amount of
 * surrounding context, capped at `maxLines` total entries. Returns the
 * trimmed rows and a count of how many further changed lines were elided.
 *
 * Strategy:
 *   1. Find all index ranges of `add`/`del` runs.
 *   2. Pad each range with up to `contextLines` of `eq` rows on either side.
 *   3. Merge overlapping/adjacent windows.
 *   4. Emit rows from each window, separating non-adjacent windows with an
 *      `{ type: 'ellipsis' }` marker.
 *   5. Stop once we've emitted `maxLines` rows; count the rest.
 *
 * @param {Array<{ type: 'eq' | 'add' | 'del', line: string }>} rows
 * @param {{ contextLines?: number, maxLines?: number }} [opts]
 * @returns {{ visible: Array<{ type: 'eq' | 'add' | 'del' | 'ellipsis', line?: string }>, hiddenChanges: number }}
 */
export function summarizeDiff(rows, { contextLines = 1, maxLines = 20 } = {}) {
  const n = rows.length;
  if (n === 0) return { visible: [], hiddenChanges: 0 };

  // Find change ranges with context padding.
  const windows = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    if (rows[k].type === 'add' || rows[k].type === 'del') {
      const start = Math.max(0, k - contextLines);
      const end = Math.min(n - 1, k + contextLines);
      if (cur && start <= cur.end + 1) {
        cur.end = Math.max(cur.end, end);
      } else {
        if (cur) windows.push(cur);
        cur = { start, end };
      }
    }
  }
  if (cur) windows.push(cur);

  // If no changes at all, return the first few unchanged lines so the
  // Preview isn't empty (extremely unusual — the caller wouldn't render
  // the row in that case — but handle gracefully).
  if (windows.length === 0) {
    return {
      visible: rows.slice(0, maxLines),
      hiddenChanges: 0,
    };
  }

  const visible = [];
  let emitted = 0;
  let totalChanges = rows.reduce((c, r) => c + (r.type !== 'eq' ? 1 : 0), 0);
  let visibleChanges = 0;

  for (let w = 0; w < windows.length; w++) {
    const { start, end } = windows[w];
    if (w > 0) {
      visible.push({ type: 'ellipsis' });
      emitted++;
    }
    for (let k = start; k <= end; k++) {
      if (emitted >= maxLines) {
        return { visible, hiddenChanges: Math.max(0, totalChanges - visibleChanges) };
      }
      visible.push(rows[k]);
      if (rows[k].type !== 'eq') visibleChanges++;
      emitted++;
    }
  }

  return { visible, hiddenChanges: Math.max(0, totalChanges - visibleChanges) };
}
