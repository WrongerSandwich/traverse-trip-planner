// GET /api/workflow-stats — debug view of telemetry-backed `_promise` calibration.
//
// Returns the rolling p10/p50/p90 seconds + token totals for every label that
// has at least one recorded sample, plus configuration constants so a human
// can sanity-check the rolling window.
//
// No auth — this is a personal app. The endpoint is informational; recording
// happens automatically in `chat()` (see src/lib/server/ai.js).

import { json } from '@sveltejs/kit';
import {
  getAllStats,
  MAX_SAMPLES_PER_LABEL,
  STALE_WINDOW_MS,
  MIN_SAMPLES,
  DRIFT_RATIO,
} from '$lib/server/workflow-stats.js';

export function GET() {
  return json({
    stats: getAllStats(),
    config: {
      max_samples_per_label: MAX_SAMPLES_PER_LABEL,
      stale_window_ms: STALE_WINDOW_MS,
      min_samples: MIN_SAMPLES,
      drift_ratio: DRIFT_RATIO,
    },
  });
}
