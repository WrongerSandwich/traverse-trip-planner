import { redirect } from '@sveltejs/kit';

// /settings was split into /home-base and /configuration. This 308 keeps
// existing bookmarks and external links working; the more-frequently-edited
// page (home-base) is the redirect target. From there the SettingsSubnav
// gives one-click access to /configuration.
export function load() {
  redirect(308, '/home-base');
}
