/**
 * Pure helpers for editing the `vehicles` map on home.md.
 *
 * Shape (matches what /api/home returns):
 *   {
 *     rav4: { model: '...', type: 'gas', default: true, notes: '...' },
 *     bolt: { model: '...', type: 'ev', default: false, range_mi: 247, dc_fast_charge_kw: 55, notes: '...' },
 *   }
 *
 * All functions are immutable — they return a new vehicles object, never
 * mutate the input. This keeps Svelte's reactivity simple.
 */

/**
 * Mark `key` as the default vehicle and unset `default` on all others.
 * If `key` is not present in `vehicles`, returns the input unchanged.
 *
 * @param {Record<string, object>} vehicles
 * @param {string} key
 * @returns {Record<string, object>}
 */
export function setDefaultVehicle(vehicles, key) {
  if (!vehicles || !(key in vehicles)) return vehicles;
  const next = {};
  for (const [k, v] of Object.entries(vehicles)) {
    next[k] = { ...v, default: k === key };
  }
  return next;
}

/**
 * Add a blank vehicle entry at `key`. If `key` already exists, returns the
 * input unchanged (caller should validate first). The new entry inherits
 * sensible defaults; if this is the only vehicle it's auto-marked default.
 *
 * @param {Record<string, object>} vehicles
 * @param {string} key
 * @param {object} [seed] - optional initial fields (model, type, etc.)
 * @returns {Record<string, object>}
 */
export function addVehicle(vehicles, key, seed = {}) {
  if (!key || (vehicles && key in vehicles)) return vehicles;
  const isFirst = !vehicles || Object.keys(vehicles).length === 0;
  return {
    ...(vehicles ?? {}),
    [key]: {
      model: seed.model ?? '',
      type: seed.type ?? 'gas',
      default: isFirst,
      notes: seed.notes ?? '',
      ...(seed.type === 'ev'
        ? { range_mi: seed.range_mi ?? null, dc_fast_charge_kw: seed.dc_fast_charge_kw ?? null }
        : {}),
    },
  };
}

/**
 * Remove the vehicle at `key`. If that vehicle was the default, auto-promote
 * the first remaining vehicle to default so the map always has exactly one
 * (unless the map is now empty).
 *
 * @param {Record<string, object>} vehicles
 * @param {string} key
 * @returns {Record<string, object>}
 */
export function removeVehicle(vehicles, key) {
  if (!vehicles || !(key in vehicles)) return vehicles;
  const wasDefault = !!vehicles[key].default;
  const next = {};
  for (const [k, v] of Object.entries(vehicles)) {
    if (k !== key) next[k] = v;
  }
  if (wasDefault) {
    const remainingKeys = Object.keys(next);
    if (remainingKeys.length > 0) {
      next[remainingKeys[0]] = { ...next[remainingKeys[0]], default: true };
    }
  }
  return next;
}

/**
 * Update one field on a single vehicle. If the field is `type` and the new
 * value is not `ev`, strip the EV-only fields so they don't persist as
 * orphan keys on a gas vehicle.
 *
 * @param {Record<string, object>} vehicles
 * @param {string} key
 * @param {string} field
 * @param {*} value
 * @returns {Record<string, object>}
 */
export function updateVehicleField(vehicles, key, field, value) {
  if (!vehicles || !(key in vehicles)) return vehicles;
  const current = vehicles[key];
  let updated;
  if (field === 'type' && value !== 'ev') {
    const { range_mi, dc_fast_charge_kw, ...rest } = current;
    updated = { ...rest, type: value };
  } else {
    updated = { ...current, [field]: value };
  }
  return { ...vehicles, [key]: updated };
}

/**
 * Validate the vehicles map for save. Returns an array of human-readable
 * errors; empty array means the map is OK to persist.
 *
 * Rules:
 *   - At least one vehicle.
 *   - Exactly one entry has `default: true`.
 *   - Every entry has a non-empty `type` that's either `gas` or `ev`.
 *   - EV entries must have a positive `range_mi`.
 *   - Keys are non-empty kebab-case-ish (letters/digits/dashes only).
 *
 * @param {Record<string, object>} vehicles
 * @returns {string[]}
 */
export function validateVehicles(vehicles) {
  const errors = [];
  const entries = Object.entries(vehicles ?? {});
  if (entries.length === 0) {
    errors.push('At least one vehicle is required.');
    return errors;
  }
  const defaultCount = entries.filter(([, v]) => v.default).length;
  if (defaultCount !== 1) {
    errors.push(`Exactly one vehicle must be marked default (found ${defaultCount}).`);
  }
  for (const [k, v] of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(k)) {
      errors.push(`Vehicle key "${k}" must be alphanumeric or contain dashes.`);
    }
    if (v.type !== 'gas' && v.type !== 'ev') {
      errors.push(`Vehicle "${k}" must have type "gas" or "ev".`);
    }
    if (v.type === 'ev') {
      const r = Number(v.range_mi);
      if (!isFinite(r) || r <= 0) {
        errors.push(`EV "${k}" must have a positive range_mi.`);
      }
    }
  }
  return errors;
}
