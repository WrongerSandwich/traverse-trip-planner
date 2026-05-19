/**
 * DOM-safe popup builders for Leaflet maps.
 *
 * All user-facing strings (title, destination, slug, city) are set via
 * `textContent`, never via innerHTML or template-string interpolation, so
 * HTML-special characters in frontmatter values cannot execute as markup.
 *
 * Each builder returns an HTMLElement that can be passed directly to
 * Leaflet's `setContent()` or `bindPopup()`.
 */

/**
 * Build the popup element shown when a trip marker is clicked.
 *
 * @param {{ title?: string, destination?: string, _slug: string }} trip
 * @returns {HTMLDivElement}
 */
export function buildTripPopup(trip) {
  const wrapper = document.createElement('div');
  wrapper.className = 'map-popup';

  const strong = document.createElement('strong');
  strong.textContent = trip.title || trip._slug;
  wrapper.appendChild(strong);

  const small = document.createElement('small');
  small.textContent = trip.destination || '';
  wrapper.appendChild(small);

  const btn = document.createElement('button');
  btn.className = 'map-popup-open';
  btn.dataset.slug = trip._slug;
  btn.textContent = 'Open details →';
  wrapper.appendChild(btn);

  return wrapper;
}

/**
 * Build the popup element shown when the home marker is clicked.
 *
 * @param {{ city?: string }} home
 * @returns {HTMLDivElement}
 */
export function buildHomePopup(home) {
  const wrapper = document.createElement('div');
  wrapper.className = 'map-popup';

  const strong = document.createElement('strong');
  strong.textContent = home.city || '';
  wrapper.appendChild(strong);

  const small = document.createElement('small');
  small.textContent = 'Home base';
  wrapper.appendChild(small);

  return wrapper;
}
