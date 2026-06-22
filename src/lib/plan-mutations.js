//
// Pure optimistic state transitions for the shaping bench. Each takes an
// immutable { plan, candidates } snapshot and returns the next one, mirroring
// the server semantics in src/lib/server/plan.js so the optimistic guess
// matches what an `invalidate('app:trip')` refetch returns. No Svelte, no I/O.

/** Deep-ish clone sufficient for plan/candidates (arrays of plain objects). */
function clone(state) {
  return {
    plan: { ...state.plan, days: (state.plan?.days ?? []).map((d) => ({ ...d, stops: [...(d.stops ?? [])] })) },
    candidates: {
      stops:   [...(state.candidates?.stops   ?? [])],
      lodging: [...(state.candidates?.lodging ?? [])],
    },
  };
}

function findDay(plan, dayNumber) {
  return plan.days.find((d) => d.number === dayNumber);
}

export function applyReorder(state, { dayNumber, order }) {
  const next = clone(state);
  const day = findDay(next.plan, dayNumber);
  if (day) day.stops = [...order];
  return next;
}

export function applyPromote(state, { id, dayNumber }) {
  const next = clone(state);
  if (next.plan.days.length === 0) next.plan.days.push({ number: 1, stops: [] });
  const target = dayNumber == null ? next.plan.days[0] : findDay(next.plan, dayNumber);
  if (!target) return next;
  const isLodging = (next.candidates?.lodging ?? []).some((l) => l.id === id);
  if (isLodging) target.lodging_id = id;
  else if (!target.stops.includes(id)) target.stops.push(id);
  return next;
}

export function applyMoveStop(state, { fromDay, toDay, stopId }) {
  const next = clone(state);
  const from = findDay(next.plan, fromDay);
  const to = findDay(next.plan, toDay);
  if (from) from.stops = from.stops.filter((x) => x !== stopId);
  if (to && !to.stops.includes(stopId)) to.stops.push(stopId);
  return next;
}

export function applyRemoveStop(state, { dayNumber, id }) {
  const next = clone(state);
  const day = findDay(next.plan, dayNumber);
  if (day) day.stops = day.stops.filter((x) => x !== id);
  return next;
}

export function applySetLodging(state, { dayNumber, id }) {
  const next = clone(state);
  const day = findDay(next.plan, dayNumber);
  if (!day) return next;
  if (id == null) delete day.lodging_id;
  else day.lodging_id = id;
  return next;
}

export function applyUnpromote(state, { id }) {
  const next = clone(state);
  for (const day of next.plan.days) {
    day.stops = day.stops.filter((x) => x !== id);
    if (day.lodging_id === id) delete day.lodging_id;
  }
  return next;
}
