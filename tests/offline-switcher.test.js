/**
 * Regression coverage for the offline bundle's inline day-switcher (#443).
 *
 * The switcher is a vanilla-JS IIFE embedded as a string in
 * render-offline-today.js — it ships to users as a frozen artifact and runs
 * only in a browser, so unit tests of the renderer never execute it. Here we
 * render the bundle, mount its DOM + script in jsdom against a mocked clock,
 * and assert the two behaviours that matter: default-day resolution on load
 * (mirroring resolveCurrentDay) and click-to-switch toggling.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderOfflineToday } from '../src/lib/server/render-offline-today.js';

function vmWithDays() {
  const mkStop = (name) => ({
    name, category: 'misc', description: '', hours: '', address: '',
    website: null, phone: null, coords: { lat: 1, lng: 2 }, tips: [], todos: [],
  });
  return {
    title: 'Trip', destination: 'Town', generatedAt: new Date('2026-06-07T12:00:00Z'),
    defaultDay: 1,
    days: [
      { n: 1, date: '2026-08-14', stops: [mkStop('A')], lodging: null },
      { n: 2, date: '2026-08-15', stops: [mkStop('B')], lodging: null },
      { n: 3, date: '2026-08-16', stops: [mkStop('C')], lodging: null },
    ],
    fieldGuideNotes: [], gotchas: [],
  };
}

/** Render the bundle, mount its body + run its inline switcher in jsdom. */
function mountBundle(vm) {
  const html = renderOfflineToday(vm);
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  const script = body.match(/<script>([\s\S]*?)<\/script>/)[1];
  document.body.innerHTML = body.replace(/<script>[\s\S]*?<\/script>/, '');
  // The IIFE references the global `document` / `Date`, both provided by jsdom.
  new Function(script)();
}

function visibleDay() {
  const shown = [...document.querySelectorAll('.day')].filter((d) => !d.hidden);
  return shown.length === 1 ? shown[0].getAttribute('data-day') : `(${shown.length} visible)`;
}
function activePill() {
  const active = [...document.querySelectorAll('.day-pill.active')];
  return active.length === 1 ? active[0].getAttribute('data-day') : `(${active.length} active)`;
}

describe('offline bundle inline day-switcher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens to the day whose date is today (exact match)', () => {
    vi.setSystemTime(new Date('2026-08-15T12:00:00'));
    mountBundle(vmWithDays());
    expect(visibleDay()).toBe('2');
    expect(activePill()).toBe('2');
  });

  it('opens to the generation-time default day when the trip is in the future', () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00')); // before all trip dates
    mountBundle(vmWithDays());
    expect(visibleDay()).toBe('1'); // data-default-day
  });

  it('opens to the last day when the trip is already over', () => {
    vi.setSystemTime(new Date('2026-12-01T12:00:00')); // after all trip dates
    mountBundle(vmWithDays());
    expect(visibleDay()).toBe('3');
  });

  it('switches days when a pill is clicked', () => {
    vi.setSystemTime(new Date('2026-08-14T12:00:00'));
    mountBundle(vmWithDays());
    expect(visibleDay()).toBe('1');

    document.querySelector('.day-pill[data-day="3"]').click();
    expect(visibleDay()).toBe('3');
    expect(activePill()).toBe('3');

    document.querySelector('.day-pill[data-day="2"]').click();
    expect(visibleDay()).toBe('2');
    expect(activePill()).toBe('2');
  });
});
