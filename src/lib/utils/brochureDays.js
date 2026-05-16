/**
 * Pure helper for rendering brochure.days structured data.
 *
 * Takes the `days` array from a parsed brochure and returns a flat array of
 * day descriptors ready for the BrochureDayView component to iterate over.
 *
 * Each returned object has:
 *   { n, theme, periods: [{ label, items: [{ time, activity }] }] }
 *
 * Empty periods (blocks with no items) are filtered out.
 *
 * @param {Array} days - brochure.data.days array
 * @returns {Array}
 */
export function flattenBrochureDays(days) {
  if (!Array.isArray(days)) return [];

  const PERIOD_LABELS = {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    optional: 'Optional',
  };

  return days.map((day) => {
    const periods = (day.blocks ?? [])
      .filter((block) => Array.isArray(block.items) && block.items.length > 0)
      .map((block) => ({
        label: PERIOD_LABELS[block.period] ?? capitalize(block.period ?? ''),
        items: block.items.map((item) => ({
          time: item.time ?? null,
          activity: item.activity ?? '',
        })),
      }));

    return {
      n: day.n ?? null,
      theme: day.theme ?? null,
      periods,
    };
  });
}

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
