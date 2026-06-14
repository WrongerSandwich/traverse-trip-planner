// Which category filter chips to render: the distinct, known categories
// present in the candidate pool, returned in canonical (palette) order.
const CANON = ['historic', 'cultural', 'food', 'entertainment', 'outdoors', 'view', 'quirky', 'shopping', 'misc'];

export function activeCategories(candidates = []) {
  const present = new Set(candidates.map((c) => c?.category).filter((c) => CANON.includes(c)));
  return CANON.filter((c) => present.has(c));
}
