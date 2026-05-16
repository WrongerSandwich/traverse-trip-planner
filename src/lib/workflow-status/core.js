// Workflow-status core: state model + registry resolution.
//
// Used by the per-archetype Svelte wrappers (InstantInlineStatus,
// StreamBanner, AmbientBackgroundStatus). The archetype wrappers handle
// layout; this module handles "what sentence and affordances should I
// show?" given a state, optional error code, and optional override
// sentence. Conversational / Modal flows use a bespoke modal shell
// (see `RetroModal.svelte`) rather than a shared primitive.
//
// See docs/ai-workflow-ux.md §2 (per-archetype envelopes) and §5 (failure
// recovery contract). Failure rendering MUST consume ERROR_REGISTRY — no
// inline catch sentences anywhere in components.

// Import from the client-safe registry (no node imports, no side effects) so
// workflow-status components can be used in browser routes as well as server code.
// $lib/server/errors.js re-exports these for backwards compat with server-only imports.
import { ERROR_REGISTRY } from '../errors-registry.js';

/** Canonical workflow states. Wrappers branch their envelope on these. */
export const STATES = ['idle', 'in_progress', 'success', 'failure', 'cancelled'];

const STATE_SET = new Set(STATES);

/** Map a state to a "tone" wrappers can use for color/accent decisions. */
const TONE_BY_STATE = {
  idle: 'neutral',
  in_progress: 'progress',
  success: 'success',
  failure: 'failure',
  cancelled: 'cancelled',
};

const FALLBACK_FAILURE_SENTENCE = 'Something went wrong.';

/**
 * Resolve a user-facing sentence for an error code, interpolating any
 * `{key}` placeholders from `context`. Returns null when no code is given;
 * returns a generic fallback when the code is unknown to the registry.
 *
 * @param {{ code?: string|null, context?: Record<string,string> }} opts
 * @returns {string|null}
 */
export function resolveSentence({ code, context } = {}) {
  if (!code) return null;
  const entry = ERROR_REGISTRY[code];
  if (!entry) return FALLBACK_FAILURE_SENTENCE;
  return interpolate(entry.sentence, context || {});
}

/**
 * Return the affordance list for an error code, or [] if the code is
 * unknown or falsy.
 *
 * @param {string|null|undefined} code
 * @returns {string[]}
 */
export function resolveAffordances(code) {
  if (!code) return [];
  const entry = ERROR_REGISTRY[code];
  if (!entry) return [];
  return [...entry.affordances];
}

/**
 * Resolve a complete status envelope: tone + sentence + affordances.
 *
 * - `failure` with a `code`: pulls sentence + affordances from the registry.
 *   `context` interpolates `{key}` placeholders. Caller can override
 *   affordances explicitly.
 * - `cancelled`: special-cased to use the `cancelled` registry entry by
 *   default; tone is `cancelled` (distinct from failure so wrappers can
 *   show a quieter envelope).
 * - other states: caller-provided `sentence` is used verbatim;
 *   affordances default to [].
 *
 * @param {object} opts
 * @param {string} opts.state One of STATES.
 * @param {string} [opts.sentence] Caller-provided sentence (used for non-failure states).
 * @param {string|null} [opts.code] Error code (for failure state).
 * @param {Record<string,string>} [opts.context] Interpolation values.
 * @param {string[]} [opts.affordances] Override affordances.
 * @returns {{ tone: string, sentence: string|null, affordances: string[] }}
 */
export function resolveStatus({ state, sentence, code, context, affordances } = {}) {
  if (!STATE_SET.has(state)) {
    throw new Error(`Unknown state: ${state}`);
  }

  const tone = TONE_BY_STATE[state];

  if (state === 'failure') {
    const resolvedSentence = resolveSentence({ code, context }) ?? sentence ?? FALLBACK_FAILURE_SENTENCE;
    const resolvedAffordances = affordances ?? resolveAffordances(code);
    return { tone, sentence: resolvedSentence, affordances: resolvedAffordances };
  }

  if (state === 'cancelled') {
    const resolvedSentence = sentence ?? resolveSentence({ code: code || 'cancelled', context }) ?? FALLBACK_FAILURE_SENTENCE;
    const resolvedAffordances = affordances ?? resolveAffordances(code || 'cancelled');
    return { tone, sentence: resolvedSentence, affordances: resolvedAffordances };
  }

  return {
    tone,
    sentence: sentence ?? null,
    affordances: affordances ?? [],
  };
}

/**
 * Format a token count for display. Returns `null` when there is nothing
 * meaningful to show (0, negative, or missing).
 *
 * - sub-thousand: `"450 tokens"`
 * - exact thousands: `"5k tokens"`
 * - mixed: `"12.4k tokens"`
 *
 * @param {number|null|undefined} count
 * @returns {string|null}
 */
export function formatTokens(count) {
  if (count == null) return null;
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  if (count <= 0) return null;
  if (count < 1000) return `${Math.round(count)} tokens`;
  const k = count / 1000;
  const rounded = Math.round(k * 10) / 10;
  const label = Number.isInteger(rounded) ? `${rounded}k` : `${rounded.toFixed(1)}k`;
  return `${label} tokens`;
}

// ── helpers ──────────────────────────────────────────────────────────────

function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}
