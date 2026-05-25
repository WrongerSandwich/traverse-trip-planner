/**
 * Deterministic YAML cleanup for LLM-generated structured output.
 *
 * Used by the deepen handler on the model's `<plan>` and `<candidates>` block
 * content before `yaml.parse()`. Targets the narrow set of emission mistakes
 * that opus-class models reliably make when emitting YAML with prose values
 * (long `description:` fields, multi-clause `- ` bullets) — specifically,
 * wrapping a value onto a continuation line that starts at column 1, which
 * strict YAML reads as a new implicit key.
 *
 * Pairs with the prompt-side fix (#417): the prompt asks for single-line
 * quoted strings, this is the defense-in-depth pass for when the model
 * doesn't comply. Together with the retry-on-invalid-YAML loop, this lets
 * the deepen happy path complete on opus-4-7 without user-visible failures.
 *
 * @param {string} raw - the model's raw YAML block content
 * @returns {string} - YAML with column-1 continuations folded back inline
 */
export function cleanupModelYaml(raw) {
  if (typeof raw !== 'string') return '';

  // 1. Normalize line endings + strip trailing whitespace per line. Mirrors
  //    cleanupLLMMarkdown — keeps diffs clean and avoids invisible chars
  //    from confusing the line-merging logic below.
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));

  // 2. Re-merge column-1 continuations into the preceding key/dash line.
  //
  //    The failure shape we're fixing:
  //
  //        description:
  //        Long value that wrapped to column 1
  //        (possibly more wrapped lines)
  //
  //    Becomes:
  //
  //        description: Long value that wrapped to column 1 (possibly more wrapped lines)
  //
  //    Triggered when:
  //      - A line matches `<indent><key>:` or `<indent>- ` with no value after.
  //      - The next line is non-blank and starts at column 1 (no indent).
  //      - The next line is NOT itself a new YAML structure (key:, list dash,
  //        comment, document separator). Column-1 content can legitimately be
  //        a top-level key — we only fold lines whose shape isn't already
  //        valid YAML on its own.
  //
  //    Multiple consecutive wrapped lines fold together with a single space
  //    between them (matching how prose wraps in source typically reads).
  const out = [];
  const KEY_OR_DASH_EMPTY = /^(\s*)((?:[\w_]+:|-))\s*$/;
  const LOOKS_LIKE_YAML = /^(?:\s*(?:[\w_]+\s*:|-\s|#|---|\.\.\.)|\s*$)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(KEY_OR_DASH_EMPTY);
    if (!m) {
      out.push(line);
      i += 1;
      continue;
    }

    const [, indent, prefix] = m;
    const wrapped = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (next === '') break;                 // blank line ends the wrap
      if (next[0] === ' ' || next[0] === '\t') break; // properly indented — leave alone
      if (LOOKS_LIKE_YAML.test(next)) break;  // a real new YAML node
      wrapped.push(next);
      j += 1;
    }

    if (wrapped.length > 0) {
      const joined = wrapped.map((w) => w.trim()).join(' ');
      out.push(`${indent}${prefix} ${joined}`);
      i = j;
    } else {
      out.push(line);
      i += 1;
    }
  }

  return out.join('\n');
}
