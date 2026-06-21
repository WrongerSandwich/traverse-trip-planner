import { describe, it, expect } from 'vitest';
import {
  applyReorder, applyPromote, applyMoveStop,
  applyRemoveStop, applySetLodging, applyUnpromote,
} from '../src/lib/plan-mutations.js';

const base = () => ({
  plan: { days: [
    { number: 1, stops: ['a', 'b'] },
    { number: 2, stops: ['c'] },
  ] },
  candidates: {
    stops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    lodging: [{ id: 'inn' }],
  },
});

describe('applyReorder', () => {
  it('sets a day stops to the new order', () => {
    const next = applyReorder(base(), { dayNumber: 1, order: ['b', 'a'] });
    expect(next.plan.days[0].stops).toEqual(['b', 'a']);
  });
  it('does not mutate the input', () => {
    const s = base();
    applyReorder(s, { dayNumber: 1, order: ['b', 'a'] });
    expect(s.plan.days[0].stops).toEqual(['a', 'b']);
  });
});

describe('applyPromote', () => {
  it('appends a stop candidate to the target day', () => {
    const next = applyPromote(base(), { id: 'd', dayNumber: 2 });
    expect(next.plan.days[1].stops).toEqual(['c', 'd']);
  });
  it('is idempotent if the stop is already in the day', () => {
    const next = applyPromote(base(), { id: 'c', dayNumber: 2 });
    expect(next.plan.days[1].stops).toEqual(['c']);
  });
  it('null dayNumber targets the first day', () => {
    const next = applyPromote(base(), { id: 'd', dayNumber: null });
    expect(next.plan.days[0].stops).toEqual(['a', 'b', 'd']);
  });
  it('sets lodging_id when the candidate is lodging', () => {
    const next = applyPromote(base(), { id: 'inn', dayNumber: 1 });
    expect(next.plan.days[0].lodging_id).toBe('inn');
    expect(next.plan.days[0].stops).toEqual(['a', 'b']);
  });
  it('creates day 1 when no days exist', () => {
    const empty = { plan: { days: [] }, candidates: base().candidates };
    const next = applyPromote(empty, { id: 'a', dayNumber: null });
    expect(next.plan.days).toEqual([{ number: 1, stops: ['a'] }]);
  });
});

describe('applyMoveStop', () => {
  it('removes from source and appends to target', () => {
    const next = applyMoveStop(base(), { fromDay: 1, toDay: 2, stopId: 'a' });
    expect(next.plan.days[0].stops).toEqual(['b']);
    expect(next.plan.days[1].stops).toEqual(['c', 'a']);
  });
  it('does not duplicate if already in target', () => {
    const s = base(); s.plan.days[1].stops = ['c', 'a'];
    const next = applyMoveStop(s, { fromDay: 1, toDay: 2, stopId: 'a' });
    expect(next.plan.days[1].stops).toEqual(['c', 'a']);
  });
});

describe('applyRemoveStop', () => {
  it('removes the stop from the day', () => {
    const next = applyRemoveStop(base(), { dayNumber: 1, id: 'a' });
    expect(next.plan.days[0].stops).toEqual(['b']);
  });
});

describe('applySetLodging', () => {
  it('sets lodging_id', () => {
    const next = applySetLodging(base(), { dayNumber: 1, id: 'inn' });
    expect(next.plan.days[0].lodging_id).toBe('inn');
  });
  it('clears lodging_id when id is null', () => {
    const s = base(); s.plan.days[0].lodging_id = 'inn';
    const next = applySetLodging(s, { dayNumber: 1, id: null });
    expect(next.plan.days[0].lodging_id).toBeUndefined();
  });
});

describe('applyUnpromote', () => {
  it('removes the id from every day stops and lodging', () => {
    const s = base(); s.plan.days[0].lodging_id = 'inn';
    const next = applyUnpromote(s, { id: 'a' });
    expect(next.plan.days[0].stops).toEqual(['b']);
    const next2 = applyUnpromote(s, { id: 'inn' });
    expect(next2.plan.days[0].lodging_id).toBeUndefined();
  });
});
