import { error } from '@sveltejs/kit';
import { enrichTrips, isValidSlug } from '$lib/server/data.js';
import { deriveBrochure } from '$lib/server/derive-brochure.js';
import { resolveCurrentDay } from '$lib/today.js';

// deriveBrochure normalizes coords to [lat, lng] arrays; today.js / TodayStopCard
// expect {lat, lng} objects so navUrl() can use stop.coords.lat / .lng. Convert
// here so all downstream consumers get consistent object-shaped coords.
function arrayToObjCoords(coords) {
  if (!coords) return null;
  if (Array.isArray(coords) && coords.length === 2) {
    const [lat, lng] = coords;
    return { lat, lng };
  }
  // Already an object (e.g. if the shape ever changes upstream) — pass through.
  return coords;
}

function normalizeStopCoords(stop) {
  return { ...stop, coords: arrayToObjCoords(stop.coords) };
}

function normalizeDayCoords(day) {
  if (!day) return day;
  return {
    ...day,
    stops: (day.stops ?? []).map(normalizeStopCoords),
    lodging: day.lodging
      ? { ...day.lodging, coords: arrayToObjCoords(day.lodging.coords) }
      : null,
  };
}

// Compute how many whole calendar days from today until the first day of the trip.
// Returns null when:
//   - the first day has no date
//   - the trip has already started (date <= today)
//   - the trip is in the past
// Dates compared as server-local calendar strings (YYYY-MM-DD).
function computeStartsInDays(firstDayDate) {
  if (!firstDayDate) return null;

  const today = new Date();
  // Today as a local YYYY-MM-DD string.
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  if (firstDayDate <= todayStr) return null;

  // Parse both dates as UTC midnight to get a clean day difference.
  const tripMs = new Date(`${firstDayDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const diffDays = Math.round((tripMs - todayMs) / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : null;
}

export async function load({ params, url }) {
  const { slug } = params;
  if (!isValidSlug(slug)) throw error(404);

  const trips = await enrichTrips();
  const trip = trips.find(t => t._slug === slug);
  if (!trip) throw error(404, `Trip "${slug}" not found`);

  // Derive the brochure shape on every request — no AI, no file cache.
  // Returns null when plan/candidates are missing; failures degrade to
  // the empty state rather than crashing (mirrors the brochure route).
  let brochureData = null;
  try {
    brochureData = deriveBrochure(slug);
  } catch (err) {
    console.warn(`deriveBrochure failed for ${slug}:`, err.message);
  }

  if (!brochureData) {
    return {
      hasPlan: false,
      trip,
    };
  }

  const { days, title, field_guide_notes, gotchas } = brochureData;

  // Resolve the selected day: honor a valid ?day=N param, otherwise let
  // resolveCurrentDay pick based on today's date.
  const requested = Number(url.searchParams.get('day'));
  const selected =
    Number.isInteger(requested) && requested >= 1 && requested <= days.length
      ? requested
      : resolveCurrentDay(days, new Date());

  const day = normalizeDayCoords(days[selected - 1]);

  // "Trip starts in N days" hint — only when the trip hasn't started yet.
  const startsInDays = computeStartsInDays(days[0]?.date ?? null);

  // Slim per-day metadata for the day-picker pills ("Day N · <short date>").
  const dayPills = days.map((d, i) => ({ n: d.n ?? i + 1, date: d.date ?? null }));

  return {
    hasPlan: true,
    trip,
    title: title ?? trip.title ?? slug,
    destination: trip.destination ?? '',
    selectedDay: selected,
    dayCount: days.length,
    dayPills,
    day,
    fieldGuideNotes: field_guide_notes ?? [],
    gotchas: gotchas ?? [],
    startsInDays,
  };
}
