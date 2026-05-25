// Hand-tuned defaults for the `_promise` objects exported by each AI route,
// plus a resolver that overlays telemetry from workflow-stats.js.
//
// See docs/ai-workflow-ux.md §3 for the contract. The route files import
// the matching constant below and re-export it as `_promise` so the route's
// public shape is unchanged. The `+layout.server.js` calls
// `getResolvedPromises()` and ships the result to the client as
// `data.promises`, which the Svelte components prefer over their local
// fallback constants.
//
// Each key is the `chat()` `label` string passed to `chat()` from the
// route. Routes that don't call `chat()` (e.g. regeocode) still appear
// here for UI surfacing but their telemetry will never populate.

import { resolvePromise } from './workflow-stats.js';

/** @typedef {{ verb: string, produces: string, time_seconds: number, tokens_range: [number, number] }} Promise */

/**
 * Per-call maxTokens budget keyed by the `chat()` label.
 * Update this table when adding or changing an AI-driven action.
 */
export const MAX_TOKENS = {
  seed: 3000,
  add: 600,
  // deepen now produces six tags in one envelope (prose + structured plan +
  // candidates YAML) — bumped from 8000 to accommodate the combined payload
  // that the old extract leg used to emit separately. Telemetry recalibrates
  // the `_promise` time/token defaults via workflow-stats rolling p50.
  deepen: 12000,
  'deepen-section': 8000,
  chat: 6000,
  'retro-questions': 600,
  'retro-save': 2000,
  receipts: 800,
  'add-candidate': 1000,
  'find-more': 6000,
};

/** @type {Record<string, Promise>} */
export const HAND_DEFAULTS = {
  add: {
    verb: 'Add destination',
    produces: 'One new trip idea file for the named destination, after checking for duplicates and road-trip viability.',
    time_seconds: 12,
    tokens_range: [400, 800],
  },
  seed: {
    verb: 'Generate ideas',
    produces: 'Five new road-trip idea files tailored to your taste profile and steering prompt.',
    time_seconds: 20,
    tokens_range: [1500, 3000],
  },
  deepen: {
    verb: 'Research trip',
    // Single unified envelope: prose sections + structured plan + candidate
    // pool emitted in one chat() round-trip with web search. Hand-default
    // starts at the prior two-leg total; telemetry recalibrates via
    // workflow-stats rolling p50 once real runs land.
    produces: 'Detailed overview, route, and logistics files — plus a structured plan and candidate pool — with web-searched hours, prices, lodging, and route specifics.',
    time_seconds: 120,
    tokens_range: [8000, 16000],
  },
  'deepen-section': {
    verb: 'Research section',
    produces: 'One trip section (route, stops, or logistics) written from web-searched current information.',
    time_seconds: 60,
    tokens_range: [2000, 4000],
  },
  receipts: {
    verb: 'Parse receipts',
    produces: 'Structured expense lines (date · merchant · amount · category) appended to your trip notes.',
    time_seconds: 10,
    tokens_range: [400, 900],
  },
  // Retro makes two `chat()` calls under different labels; the user-visible
  // trigger button surfaces the questions step.
  'retro-questions': {
    verb: 'Generate questions',
    produces: 'Five trip-specific retrospective questions drawn from your actual stops and itinerary.',
    time_seconds: 10,
    tokens_range: [300, 700],
  },
  chat: {
    verb: 'Ask Field Guide',
    produces: 'A conversational reply and any updated planning sections written directly to disk.',
    time_seconds: 20,
    tokens_range: [2000, 6000],
  },
  'add-candidate': {
    verb: 'Add candidate',
    produces: 'One new stop or lodging candidate, with category, description, and (when web-searchable) a verified source.',
    time_seconds: 18,
    tokens_range: [400, 1200],
  },
  'find-more': {
    verb: 'Find more candidates',
    produces: 'A batch of additional stop or lodging candidates, scoped to your steering prompt and de-duped against the existing pool.',
    time_seconds: 90,
    tokens_range: [4000, 12000],
  },
};

/**
 * Returns a map of `label → resolved promise`. Telemetry replaces
 * `time_seconds` (and the token range, where the hand default is non-zero)
 * when ≥MIN_SAMPLES runs are recorded for that label and drift is within
 * tolerance; otherwise the hand defaults pass through unchanged.
 */
export function getResolvedPromises() {
  const out = {};
  for (const [label, defaults] of Object.entries(HAND_DEFAULTS)) {
    try {
      out[label] = resolvePromise(label, defaults);
    } catch (e) {
      // Best-effort: telemetry must never break the load function.
      console.warn(`[workflow-stats] resolvePromise(${label}) failed: ${e?.message ?? e}`);
      out[label] = defaults;
    }
  }
  return out;
}
