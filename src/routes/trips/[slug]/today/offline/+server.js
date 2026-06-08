import { enrichTrips, rejectInvalidSlug } from '$lib/server/data.js';
import { deriveBrochure } from '$lib/server/derive-brochure.js';
import { renderOfflineToday } from '$lib/server/render-offline-today.js';
import { resolveCurrentDay, normalizeDayCoords } from '$lib/today.js';

export async function GET({ params }) {
  const invalid = rejectInvalidSlug(params.slug);
  if (invalid) return invalid;

  const brochure = deriveBrochure(params.slug);
  if (!brochure) return new Response('No plan to take offline', { status: 404 });

  // deriveBrochure does not carry the trip's destination; source it from the
  // enriched trip, mirroring the Today route's loader.
  const trips = await enrichTrips();
  const trip = trips.find((t) => t._slug === params.slug);

  const days = brochure.days.map(normalizeDayCoords);
  // resolveCurrentDay returns a 1-based position; the renderer's switcher keys
  // on day.n. These align because plan days are renumbered 1..N on edit.
  const defaultDay = resolveCurrentDay(days, new Date());

  const html = renderOfflineToday({
    title: brochure.title ?? trip?.title ?? params.slug,
    destination: trip?.destination ?? '',
    generatedAt: new Date(),
    defaultDay,
    days,
    fieldGuideNotes: brochure.field_guide_notes ?? [],
    gotchas: brochure.gotchas ?? [],
  });

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${params.slug}-today.html"`,
    },
  });
}
