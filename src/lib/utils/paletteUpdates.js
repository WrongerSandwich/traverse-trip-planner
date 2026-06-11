/**
 * Decide how a palette/chat response's section updates should be applied,
 * given which sections currently have an open textarea edit.
 *
 * The palette writes model-produced section content to disk and then mirrors
 * it into the page's local `sections` map. If the user has a section open in
 * edit mode with unsaved keystrokes, blindly overwriting `sections[section]`
 * (and closing the editor) silently discards their in-progress edit (#494).
 *
 * This splits the incoming updates into two buckets:
 *   - `applied`: sections NOT being edited. Safe to overwrite local content
 *     and surface the diff overlay immediately.
 *   - `queued`:  sections currently in edit mode. Their local content and
 *     editor state must be left untouched so the unsaved draft survives; the
 *     diff overlay is still recorded so it surfaces once the user
 *     saves/cancels their edit (editing renders ahead of the overlay).
 *
 * In BOTH cases a pending-edit record is created so the diff-and-revert
 * overlay can surface the model's change — the only difference is whether the
 * local section content / editor state is mutated now.
 *
 * @param {Record<string, string>} updates - section → new model content.
 * @param {Record<string, boolean>} editing - section → is in textarea edit mode.
 * @returns {{ applied: string[], queued: string[] }} section keys per bucket.
 */
export function partitionPaletteUpdates(updates, editing = {}) {
  const applied = [];
  const queued = [];
  for (const section of Object.keys(updates || {})) {
    if (editing && editing[section]) queued.push(section);
    else applied.push(section);
  }
  return { applied, queued };
}
