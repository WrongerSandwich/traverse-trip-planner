// Failure recovery registry — client + server safe.
//
// This file holds only pure data (no node imports, no side effects) so it can
// be imported from Svelte components rendered on the client *and* from server
// code under $lib/server. The TraverseError + AdapterError classes and their
// logging helpers stay in $lib/server/errors.js, which re-exports
// ERROR_REGISTRY + AFFORDANCES from here for backwards compatibility.

// Valid recovery affordances. UI components key off these to render the
// appropriate action button for each failure.
export const AFFORDANCES = ['retry', 'switch_provider', 'edit', 'dismiss', 'open_file'];

// Maps every TraverseError code to a user-facing sentence and recovery
// affordances. UI components import this — no inline catch sentences in
// route handlers or components.
//
// Entries with `interpolate` list named placeholders that callers must
// fill in via string replacement; each key must appear as `{key}` in
// the sentence.
export const ERROR_REGISTRY = {
  // ── Codes from the §5 spec ───────────────────────────────────────────
  empty_model_output: {
    sentence: 'The model returned no usable output. Try again, or switch providers if it keeps happening.',
    affordances: ['retry', 'switch_provider'],
  },
  geocode_quota: {
    sentence: 'Geocoding is rate-limited right now. Try again in a minute.',
    affordances: ['retry', 'dismiss'],
  },
  provider_error: {
    sentence: '{provider} returned an error: {summary}. Retry, or switch providers.',
    affordances: ['retry', 'switch_provider'],
    interpolate: ['provider', 'summary'],
  },
  timeout: {
    sentence: 'This took longer than expected and was cancelled. Retry, or try a faster model.',
    affordances: ['retry', 'switch_provider'],
  },
  invalid_input: {
    sentence: '{reason}. Edit the trip and try again.',
    affordances: ['edit'],
    interpolate: ['reason'],
  },
  file_conflict: {
    sentence: '{artifact} already exists. Delete or rename it to redo.',
    affordances: ['open_file', 'dismiss'],
    interpolate: ['artifact'],
  },
  cancelled: {
    sentence: 'Cancelled.',
    affordances: ['dismiss'],
  },
  network_error: {
    sentence: "Couldn't reach the model. Check your connection and retry.",
    affordances: ['retry'],
  },
  candidate_duplicate: {
    sentence: '"{name}" is already in your candidates. Try a different name.',
    affordances: ['dismiss'],
    interpolate: ['name'],
  },
  // ── Codes thrown elsewhere in src/ ───────────────────────────────────
  no_section_content: {
    sentence: 'The model returned no section content. Try again.',
    affordances: ['retry'],
  },
  trip_not_found: {
    sentence: 'Trip not found.',
    affordances: ['dismiss'],
  },
  wrong_stage: {
    sentence: 'This action requires a different trip stage.',
    affordances: ['dismiss'],
  },
  missing_overview: {
    sentence: 'overview.md is required for this action. Add it and try again.',
    affordances: ['edit'],
  },
  model_returned_no_yaml_block: {
    sentence: 'The model did not return the expected output block. Try again.',
    affordances: ['retry'],
  },
  model_returned_invalid_yaml: {
    sentence: 'The model returned output that failed to parse. Try again.',
    affordances: ['retry'],
  },
  model_returned_unexpected_xml: {
    sentence: 'The model returned an unexpected response shape. Try again, or switch providers if it keeps happening.',
    affordances: ['retry', 'switch_provider'],
  },
  already_running: {
    sentence: 'This action is already running for that trip. Wait for it to finish or cancel from the jobs drawer.',
    affordances: ['dismiss'],
  },
  section_changed_during_chat: {
    sentence: 'The {section} section was modified while you were chatting. Re-run your last message to apply your changes to the latest version.',
    affordances: ['retry', 'dismiss'],
    interpolate: ['section'],
  },
  home_not_configured: {
    sentence: 'home.md is not set up. Add your home base details before using AI features.',
    affordances: ['dismiss'],
  },
  action_failed: {
    sentence: "Couldn't {action}. The server log may have more detail.",
    affordances: ['dismiss'],
    interpolate: ['action'],
  },
  save_failed: {
    sentence: "Couldn't save. Try again, or check the server log if it keeps happening.",
    affordances: ['retry', 'dismiss'],
  },
  image_search_failed: {
    sentence: 'No photos found for that search. Try different words.',
    affordances: ['retry', 'dismiss'],
  },
  image_search_unconfigured: {
    sentence: 'Image search is not configured. Add a Pexels key in .env or via the configuration page.',
    affordances: ['dismiss'],
  },
  image_save_failed: {
    sentence: "Couldn't save the cover photo. Try again.",
    affordances: ['retry', 'dismiss'],
  },
  revert_failed: {
    sentence: "Couldn't revert this section. The current content is still on disk; try again.",
    affordances: ['retry', 'dismiss'],
  },
  enrich_all_failed: {
    sentence: 'Couldn\'t enrich any of the candidates — try again, or check the server log if it keeps happening.',
    affordances: ['retry', 'dismiss'],
  },
  rate_limited: {
    sentence: 'Too many requests. Try again in {retryAfterSec} seconds.',
    affordances: ['retry', 'dismiss'],
    interpolate: ['retryAfterSec'],
  },
  max_tokens_exceeded: {
    sentence: 'Internal error: requested token budget exceeds the safety ceiling. Please report this.',
    affordances: ['dismiss'],
  },
  dangling_candidate_id: {
    sentence: 'Plan references candidate "{candidate_id}" not found in candidates.md. Resolve manually.',
    affordances: ['edit', 'dismiss'],
    interpolate: ['candidate_id'],
  },
  feature_not_configured: {
    sentence: 'This feature is not configured. Check provider and model in settings.',
    affordances: ['edit', 'dismiss'],
  },
  unarchive_slug_collision: {
    sentence: 'A trip with that name already exists — rename or delete it first, then restore the archived copy.',
    affordances: ['dismiss'],
  },
  interrupted: {
    sentence: 'A previous research job was interrupted by a server restart. Try re-running it.',
    affordances: ['retry', 'dismiss'],
  },
  forbidden_remote_write: {
    sentence: 'Config writes are restricted to loopback. Set TRAVERSE_ALLOW_LAN_WRITES=1 to permit LAN writes (after confirming the network is trusted), or set TRUST_PROXY_FOR_AUTH=1 if running behind a reverse proxy. See docs/deploy.md.',
    affordances: ['dismiss'],
  },
};

/**
 * Resolve the user-facing sentence for a TraverseError code, with optional
 * context for `{placeholder}` interpolation. Returns a generic fallback when
 * the code is unknown so the UI is never empty.
 */
export function failureSentence(code, ctx = {}) {
  const entry = ERROR_REGISTRY[code];
  if (!entry) return 'Something went wrong. Try again.';
  let sentence = entry.sentence;
  if (entry.interpolate) {
    for (const key of entry.interpolate) {
      sentence = sentence.replaceAll(`{${key}}`, ctx[key] ?? '');
    }
  }
  return sentence;
}
