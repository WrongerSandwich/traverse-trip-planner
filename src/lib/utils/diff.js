/**
 * Line-level diff between two strings via longest-common-subsequence (LCS).
 *
 * Used by the Field guide chat's per-section Preview to show what changed
 * rather than dumping the full new content. The snapshot is captured client-
 * side at send-time (see chatMessages[*].snapshots[section] in
 * src/routes/trips/[slug]/+page.svelte), so the diff is just `before → after`
 * on the two strings.
 *
 * Returns an array of `{ type, line }` rows where:
 *   - type === 'eq'   line appears in both (unchanged context)
 *   - type === 'add'  line is in `after` but not `before` (insertion)
 *   - type === 'del'  line is in `before` but not `after` (removal)
 *
 * The classic LCS DP table costs O(m·n) memory. For the planning sections
 * we diff (typically <500 lines), that's well under a megabyte and runs in
 * a couple milliseconds — adequate for an interactive preview.
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ type: 'eq' | 'add' | 'del', line: string }>}
 */
export function diffLines(before, after) {
  const a = (before ?? '').split('\n');
  const b = (after ?? '').split('\n');
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
