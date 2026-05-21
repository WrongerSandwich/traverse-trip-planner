<script>
  /**
   * SectionDiffOverlay — in-section diff rendering for a pending Field guide
   * edit.
   *
   * Replaces the normal `renderMarkdown(sections[section])` output when a
   * model turn has proposed a change to this section. Renders a header
   * banner with the conversational reply + Accept/Revert affordances, then
   * the section body with added/removed paragraphs marked using the
   * section's own prose typography (no monospace, no +/− glyphs).
   *
   * The diff is paragraph-level (markdown paragraph break = one or more
   * blank lines). Each surviving block gets rendered via `renderMarkdown`
   * so headings, lists, emphasis, etc. all behave correctly. Added blocks
   * carry a 2px --state-success left border + a low-alpha tint wash;
   * removed blocks dim to 55% opacity with a struck-through prose treatment
   * (semantic, not engineering — readers see "previous draft," not "git").
   *
   * Long runs of unchanged blocks collapse to a "+N unchanged paragraphs"
   * stub that the user can expand. Adjacent change blocks keep their
   * context blocks visible.
   *
   * Props:
   *   - before: string                pre-edit content (the snapshot)
   *   - after: string                 post-edit content (the new section)
   *   - reply: string                 model's conversational reply text
   *   - assistantName: string         display name for the banner
   *   - outOfDate: boolean            true when a later turn touched this section
   *   - turnAt: number                ms timestamp the turn landed (banner copy)
   *   - sectionAnchor: string         href fragment for the "View current state" link
   *   - onaccept(): void              dismiss banner, keep new content
   *   - onrevert(): void              put pre-edit content back
   */

  import { renderMarkdown } from '$lib/sanitize.js';
  import { diffBlocks } from '$lib/utils/diff.js';

  /** @type {{
   *   before: string,
   *   after: string,
   *   reply: string,
   *   assistantName: string,
   *   outOfDate?: boolean,
   *   turnAt?: number,
   *   sectionAnchor: string,
   *   onaccept: () => void,
   *   onrevert: () => void,
   * }} */
  let {
    before,
    after,
    reply,
    assistantName,
    outOfDate = false,
    turnAt = Date.now(),
    sectionAnchor,
    onaccept,
    onrevert,
  } = $props();

  // Collapse runs of unchanged paragraphs longer than this into a "+N
  // unchanged" stub the user can expand inline. Keeps the in-section
  // overlay readable for whole-file rewrites.
  const COLLAPSE_THRESHOLD = 4;

  const blocks = $derived(diffBlocks(before ?? '', after ?? ''));

  // Walk the diff and group consecutive eq blocks into either:
  //   { type: 'eq-run', blocks: [...] } when length ≤ COLLAPSE_THRESHOLD
  //   { type: 'eq-collapsed', count, blocks } when longer (user can expand)
  // Changed blocks pass through unmodified.
  const groups = $derived.by(() => {
    const out = [];
    let run = [];
    function flushRun() {
      if (run.length === 0) return;
      if (run.length > COLLAPSE_THRESHOLD) {
        out.push({ type: 'eq-collapsed', count: run.length, blocks: run });
      } else {
        for (const b of run) out.push({ type: 'eq', line: b.line });
      }
      run = [];
    }
    for (const b of blocks) {
      if (b.type === 'eq') {
        run.push(b);
      } else {
        flushRun();
        out.push(b);
      }
    }
    flushRun();
    return out;
  });

  let expandedRuns = $state(/** @type {Record<number, boolean>} */ ({}));

  function fmtAgo(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s} seconds ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.floor(m / 60);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
</script>

<div class="section-diff" role="region" aria-label="Pending edit">
  <header class="section-diff-banner" class:stale={outOfDate}>
    <p class="banner-reply">
      <span class="banner-author">— {assistantName}:</span>
      {reply}
    </p>
    <div class="banner-actions">
      <button type="button" class="banner-accept" onclick={onaccept}>Keep changes</button>
      {#if outOfDate}
        <a class="banner-stale-link" href={sectionAnchor}>View current state ↗</a>
      {:else}
        <button
          type="button"
          class="banner-revert"
          onclick={onrevert}
          title="Puts this section back the way it was {fmtAgo(Date.now() - turnAt)}"
        >Revert</button>
      {/if}
    </div>
  </header>

  <div class="section-diff-body">
    {#each groups as group, idx (idx)}
      {#if group.type === 'eq'}
        <div class="diff-block diff-eq">{@html renderMarkdown(group.line)}</div>
      {:else if group.type === 'eq-collapsed'}
        {#if expandedRuns[idx]}
          {#each group.blocks as b, bi (bi)}
            <div class="diff-block diff-eq">{@html renderMarkdown(b.line)}</div>
          {/each}
          <button
            type="button"
            class="diff-collapse-toggle"
            onclick={() => (expandedRuns[idx] = false)}
          >Hide {group.count} unchanged paragraph{group.count === 1 ? '' : 's'}</button>
        {:else}
          <button
            type="button"
            class="diff-collapse-toggle"
            onclick={() => (expandedRuns[idx] = true)}
          >+{group.count} unchanged paragraph{group.count === 1 ? '' : 's'}</button>
        {/if}
      {:else if group.type === 'add'}
        <div class="diff-block diff-add">{@html renderMarkdown(group.line)}</div>
      {:else}
        <div class="diff-block diff-del" aria-label="Removed">{@html renderMarkdown(group.line)}</div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .section-diff {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Banner — italic-serif voice carrying the model's reply, with the two
     reversible affordances pinned to the right. Same surface as
     --state-success but a step quieter on the border so the section's own
     heading still leads. */
  .section-diff-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.7rem 0.9rem;
    background: color-mix(in oklab, var(--state-success) 8%, var(--surface-raised));
    border: 1px solid color-mix(in oklab, var(--state-success) 30%, var(--border-default));
    border-radius: 5px;
  }
  .section-diff-banner.stale {
    background: var(--state-warning-surface);
    border-color: color-mix(in oklab, var(--state-warning) 40%, var(--border-default));
  }
  .banner-reply {
    margin: 0;
    flex: 1;
    min-width: 14rem;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-primary);
  }
  .banner-author {
    font-style: italic;
    color: var(--text-secondary);
    margin-right: 0.15rem;
  }
  .banner-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .banner-accept,
  .banner-revert {
    background: var(--surface-page);
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.32rem 0.65rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .banner-accept {
    color: var(--state-success);
    border-color: var(--state-success);
  }
  .banner-accept:hover {
    background: color-mix(in oklab, var(--state-success) 12%, transparent);
  }
  .banner-revert {
    color: var(--text-tertiary);
  }
  .banner-revert:hover {
    background: var(--state-danger-surface);
    border-color: var(--state-danger);
    color: var(--state-danger);
  }
  .banner-stale-link {
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--state-warning);
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }
  .banner-stale-link:hover { color: var(--text-primary); }

  /* Body — each block renders via renderMarkdown. Add/del blocks get a
     stronger background tint plus a leading colored marker dot (not a
     side stripe — banned per the shared design laws). No mono font, no
     +/− glyphs in the prose. */
  .section-diff-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .diff-block {
    padding: 0.15rem 0.55rem;
    border-radius: 3px;
  }
  .diff-block.diff-eq { color: var(--text-primary); }
  .diff-block.diff-add,
  .diff-block.diff-del {
    position: relative;
    padding-left: 1.05rem;
  }
  .diff-block.diff-add::before,
  .diff-block.diff-del::before {
    content: '';
    position: absolute;
    left: 0.4rem;
    top: 0.55em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .diff-block.diff-add {
    background: color-mix(in oklab, var(--state-success) 10%, transparent);
  }
  .diff-block.diff-add::before {
    background: var(--state-success);
  }
  .diff-block.diff-del {
    background: color-mix(in oklab, var(--state-danger) 9%, transparent);
    opacity: 0.55;
  }
  .diff-block.diff-del::before {
    background: var(--state-danger);
  }
  /* Strikethrough only on prose text, not on headings — strikethrough headings
     read as "deleted the whole section," which isn't what we mean. */
  .diff-block.diff-del :global(p),
  .diff-block.diff-del :global(li) {
    text-decoration: line-through;
    text-decoration-color: color-mix(in oklab, var(--state-danger) 55%, transparent);
  }
  /* The collapse stub doubles as both the "+N unchanged" reveal and the
     "Hide N unchanged" collapse — quiet, sentence-case, full-width row. */
  .diff-collapse-toggle {
    background: none;
    border: 1px dashed var(--border-default);
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 500;
    padding: 0.3rem 0.65rem;
    border-radius: 3px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .diff-collapse-toggle:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
    background: var(--surface-raised);
  }
</style>
