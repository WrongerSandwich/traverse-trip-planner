import { redirect } from '@sveltejs/kit';
import { getFeatureAvailability } from '$lib/server/config.js';

export function load() {
  // If home.md is already set up, the wizard has nothing to do — bounce
  // the user back to the home page rather than letting them overwrite
  // their configured home.md by accident. Editing lives at /settings.
  const features = getFeatureAvailability();
  if (features.homeMdReady) {
    throw redirect(303, '/');
  }
  return {};
}
