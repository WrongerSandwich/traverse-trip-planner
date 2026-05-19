/**
 * Returns true when any draft value differs from the corresponding saved
 * section content, indicating the user has unsaved edits.
 *
 * @param {Record<string, string>} drafts   - Active per-section draft values.
 * @param {Record<string, string|undefined>} sections - Saved section content.
 * @returns {boolean}
 */
export function isSectionsDirty(drafts, sections) {
  return Object.entries(drafts).some(
    ([section, draft]) => draft !== (sections[section] ?? '')
  );
}
