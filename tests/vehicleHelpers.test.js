import { describe, it, expect } from 'vitest';
import {
  setDefaultVehicle,
  addVehicle,
  removeVehicle,
  updateVehicleField,
  validateVehicles,
} from '../src/lib/utils/vehicleHelpers.js';

const sample = () => ({
  rav4: { model: '2019 RAV4', type: 'gas', default: true, notes: 'a' },
  bolt: { model: '2023 Bolt', type: 'ev', default: false, range_mi: 247, dc_fast_charge_kw: 55, notes: 'b' },
});

// ── setDefaultVehicle ────────────────────────────────────────────────

describe('setDefaultVehicle', () => {
  it('marks the target default and unsets all others', () => {
    const next = setDefaultVehicle(sample(), 'bolt');
    expect(next.rav4.default).toBe(false);
    expect(next.bolt.default).toBe(true);
  });

  it('is a no-op when the key does not exist', () => {
    const before = sample();
    const next = setDefaultVehicle(before, 'nonexistent');
    expect(next).toEqual(before);
  });

  it('does not mutate the input object', () => {
    const before = sample();
    setDefaultVehicle(before, 'bolt');
    expect(before.rav4.default).toBe(true);
    expect(before.bolt.default).toBe(false);
  });

  it('always leaves exactly one default vehicle', () => {
    const next = setDefaultVehicle(sample(), 'bolt');
    const defaults = Object.values(next).filter((v) => v.default);
    expect(defaults).toHaveLength(1);
  });
});

// ── addVehicle ───────────────────────────────────────────────────────

describe('addVehicle', () => {
  it('adds a new gas vehicle with sensible defaults', () => {
    const next = addVehicle(sample(), 'subaru');
    expect(next.subaru).toEqual({
      model: '',
      type: 'gas',
      default: false,
      notes: '',
    });
  });

  it('marks the first vehicle as default when the map starts empty', () => {
    const next = addVehicle({}, 'first');
    expect(next.first.default).toBe(true);
  });

  it('is a no-op when the key is empty or already exists', () => {
    expect(addVehicle(sample(), '')).toEqual(sample());
    expect(addVehicle(sample(), 'rav4')).toEqual(sample());
  });

  it('includes ev fields when seed.type is ev', () => {
    const next = addVehicle({}, 'tesla', { type: 'ev', range_mi: 300 });
    expect(next.tesla).toHaveProperty('range_mi');
    expect(next.tesla).toHaveProperty('dc_fast_charge_kw');
    expect(next.tesla.range_mi).toBe(300);
  });
});

// ── removeVehicle ────────────────────────────────────────────────────

describe('removeVehicle', () => {
  it('removes the target entry', () => {
    const next = removeVehicle(sample(), 'bolt');
    expect(next.bolt).toBeUndefined();
    expect(next.rav4).toBeDefined();
  });

  it('promotes the first remaining vehicle to default when the default is removed', () => {
    const next = removeVehicle(sample(), 'rav4');
    expect(next.bolt.default).toBe(true);
  });

  it('does not change defaults when a non-default is removed', () => {
    const next = removeVehicle(sample(), 'bolt');
    expect(next.rav4.default).toBe(true);
  });

  it('returns an empty object when the last vehicle is removed', () => {
    const oneVehicle = { only: { model: 'X', type: 'gas', default: true } };
    const next = removeVehicle(oneVehicle, 'only');
    expect(next).toEqual({});
  });

  it('is a no-op for unknown keys', () => {
    const before = sample();
    const next = removeVehicle(before, 'nonexistent');
    expect(next).toEqual(before);
  });
});

// ── updateVehicleField ───────────────────────────────────────────────

describe('updateVehicleField', () => {
  it('updates a scalar field', () => {
    const next = updateVehicleField(sample(), 'rav4', 'model', 'Updated Model');
    expect(next.rav4.model).toBe('Updated Model');
    expect(next.bolt).toEqual(sample().bolt);
  });

  it('strips ev fields when type changes from ev to gas', () => {
    const next = updateVehicleField(sample(), 'bolt', 'type', 'gas');
    expect(next.bolt.type).toBe('gas');
    expect(next.bolt).not.toHaveProperty('range_mi');
    expect(next.bolt).not.toHaveProperty('dc_fast_charge_kw');
  });

  it('leaves ev fields intact when type stays ev', () => {
    const next = updateVehicleField(sample(), 'bolt', 'type', 'ev');
    expect(next.bolt.range_mi).toBe(247);
    expect(next.bolt.dc_fast_charge_kw).toBe(55);
  });

  it('is a no-op for unknown keys', () => {
    const before = sample();
    const next = updateVehicleField(before, 'nonexistent', 'model', 'X');
    expect(next).toEqual(before);
  });
});

// ── validateVehicles ─────────────────────────────────────────────────

describe('validateVehicles', () => {
  it('passes on a valid map', () => {
    expect(validateVehicles(sample())).toEqual([]);
  });

  it('requires at least one vehicle', () => {
    expect(validateVehicles({})).toEqual(['At least one vehicle is required.']);
  });

  it('requires exactly one default', () => {
    const both = setDefaultVehicle(sample(), 'rav4');
    both.bolt.default = true; // two defaults
    const errs = validateVehicles(both);
    expect(errs.some((e) => /default/i.test(e))).toBe(true);
  });

  it('flags ev with missing or zero range_mi', () => {
    const bad = sample();
    bad.bolt.range_mi = 0;
    expect(validateVehicles(bad).some((e) => /range_mi/.test(e))).toBe(true);

    delete bad.bolt.range_mi;
    expect(validateVehicles(bad).some((e) => /range_mi/.test(e))).toBe(true);
  });

  it('flags invalid type', () => {
    const bad = sample();
    bad.rav4.type = 'diesel';
    expect(validateVehicles(bad).some((e) => /type/.test(e))).toBe(true);
  });

  it('flags invalid keys', () => {
    const bad = { 'has spaces': { model: 'X', type: 'gas', default: true } };
    expect(validateVehicles(bad).some((e) => /alphanumeric/.test(e))).toBe(true);
  });
});
