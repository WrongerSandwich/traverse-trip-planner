import { error } from '@sveltejs/kit';
import { getFeatureAvailability } from '$lib/server/config.js';

// /home-base only needs feature availability for any future advisory; the
// home.md content is fetched client-side via /api/home (same pattern as the
// pre-split /settings page).
//
// The TRAVERSE_DISABLE_SETTINGS_UI gate also blocks home-base since
// PUT /api/home is the write path it disables.
export function load() {
  if (process.env.TRAVERSE_DISABLE_SETTINGS_UI) {
    error(403, 'Settings UI is disabled on this server. Unset TRAVERSE_DISABLE_SETTINGS_UI to re-enable.');
  }
  return {
    features: getFeatureAvailability(),
  };
}
