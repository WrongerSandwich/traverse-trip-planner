// Public entry point for the workflow-status primitive family.
//
// Pick the wrapper that matches your archetype (see docs/ai-workflow-ux.md §2):
//   - InstantInlineStatus       — button-as-spinner; failure renders inline below
//   - StreamBanner              — top-of-section banner; cancel mid-stream
//   - AmbientBackgroundStatus   — content for per-trip badge, toast, drawer row
//
// Conversational / Modal uses a bespoke per-flow modal shell rather than a
// shared primitive — see `RetroModal.svelte` for the reference implementation.
//
// All share the same state model (`STATES`) and registry-driven failure
// resolution (`resolveStatus`). See ./core.js for the contract.

export { default as InstantInlineStatus } from './InstantInlineStatus.svelte';
export { default as StreamBanner } from './StreamBanner.svelte';
export { default as AmbientBackgroundStatus } from './AmbientBackgroundStatus.svelte';
export { default as AffordanceButtons } from './AffordanceButtons.svelte';

export {
  STATES,
  resolveSentence,
  resolveAffordances,
  resolveStatus,
  formatTokens,
} from './core.js';
