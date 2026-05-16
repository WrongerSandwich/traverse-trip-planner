import { describe, it, expect } from 'vitest';
import { flattenBrochureDays } from '../src/lib/utils/brochureDays.js';

describe('flattenBrochureDays', () => {
  it('returns an empty array for null/undefined input', () => {
    expect(flattenBrochureDays(null)).toEqual([]);
    expect(flattenBrochureDays(undefined)).toEqual([]);
  });

  it('returns an empty array for non-array input', () => {
    expect(flattenBrochureDays({})).toEqual([]);
    expect(flattenBrochureDays('string')).toEqual([]);
  });

  it('maps a single day with one period to the expected shape', () => {
    const days = [
      {
        n: 1,
        theme: 'Drive east, settle in',
        blocks: [
          {
            period: 'morning',
            items: [
              { time: '9:00 AM', activity: 'Depart Overland Park' },
            ],
          },
        ],
      },
    ];
    const result = flattenBrochureDays(days);
    expect(result).toHaveLength(1);
    expect(result[0].n).toBe(1);
    expect(result[0].theme).toBe('Drive east, settle in');
    expect(result[0].periods).toHaveLength(1);
    expect(result[0].periods[0].label).toBe('Morning');
    expect(result[0].periods[0].items).toHaveLength(1);
    expect(result[0].periods[0].items[0]).toEqual({
      time: '9:00 AM',
      activity: 'Depart Overland Park',
    });
  });

  it('converts period keys to title-case labels', () => {
    const days = [
      {
        n: 1,
        theme: null,
        blocks: [
          { period: 'morning',   items: [{ time: '9:00 AM',  activity: 'Breakfast' }] },
          { period: 'afternoon', items: [{ time: '1:00 PM',  activity: 'Lunch stop' }] },
          { period: 'evening',   items: [{ time: '7:00 PM',  activity: 'Dinner'     }] },
        ],
      },
    ];
    const result = flattenBrochureDays(days);
    const labels = result[0].periods.map(p => p.label);
    expect(labels).toEqual(['Morning', 'Afternoon', 'Evening']);
  });

  it('handles the "optional" period label', () => {
    const days = [
      {
        n: 1,
        theme: null,
        blocks: [{ period: 'optional', items: [{ time: null, activity: 'Side trip' }] }],
      },
    ];
    const result = flattenBrochureDays(days);
    expect(result[0].periods[0].label).toBe('Optional');
  });

  it('capitalizes unknown period keys', () => {
    const days = [
      {
        n: 1,
        theme: null,
        blocks: [{ period: 'dusk', items: [{ time: null, activity: 'Sunset walk' }] }],
      },
    ];
    const result = flattenBrochureDays(days);
    expect(result[0].periods[0].label).toBe('Dusk');
  });

  it('filters out blocks with empty items arrays', () => {
    const days = [
      {
        n: 1,
        theme: null,
        blocks: [
          { period: 'morning',   items: [] },
          { period: 'afternoon', items: [{ time: '1:00 PM', activity: 'Lunch' }] },
        ],
      },
    ];
    const result = flattenBrochureDays(days);
    expect(result[0].periods).toHaveLength(1);
    expect(result[0].periods[0].label).toBe('Afternoon');
  });

  it('handles items with no time field', () => {
    const days = [
      {
        n: 1,
        theme: 'Flexible day',
        blocks: [
          { period: 'morning', items: [{ activity: 'Wander around' }] },
        ],
      },
    ];
    const result = flattenBrochureDays(days);
    expect(result[0].periods[0].items[0]).toEqual({ time: null, activity: 'Wander around' });
  });

  it('handles a day with no blocks', () => {
    const days = [{ n: 2, theme: 'Rest day', blocks: [] }];
    const result = flattenBrochureDays(days);
    expect(result).toHaveLength(1);
    expect(result[0].periods).toHaveLength(0);
  });

  it('handles a day with no blocks field', () => {
    const days = [{ n: 3, theme: 'Drive home' }];
    const result = flattenBrochureDays(days);
    expect(result[0].periods).toHaveLength(0);
  });

  it('maps multiple days preserving order', () => {
    const days = [
      { n: 1, theme: 'Day one', blocks: [{ period: 'morning', items: [{ time: '8:00 AM', activity: 'Start' }] }] },
      { n: 2, theme: 'Day two', blocks: [{ period: 'afternoon', items: [{ time: '2:00 PM', activity: 'End'   }] }] },
    ];
    const result = flattenBrochureDays(days);
    expect(result).toHaveLength(2);
    expect(result[0].n).toBe(1);
    expect(result[1].n).toBe(2);
    expect(result[0].theme).toBe('Day one');
    expect(result[1].theme).toBe('Day two');
  });

  it('maps the real Arrow Rock brochure shape correctly', () => {
    // Mirrors planning/arrow-rock-santa-fe-trail/brochure.md days array (abridged)
    const days = [
      {
        n: 1,
        theme: 'Drive east, settle into the village, dinner on Main Street',
        blocks: [
          {
            period: 'morning',
            items: [{ time: '9:00 AM', activity: 'Depart Overland Park via I-70 East' }],
          },
          {
            period: 'afternoon',
            items: [
              { time: '11:45 AM', activity: 'Arrive Arrow Rock — visitor center' },
              { time: '1:00 PM',  activity: 'Self-guided walking tour of village' },
            ],
          },
          {
            period: 'evening',
            items: [
              { time: '5:00 PM', activity: 'Dinner at Catalpa or J. Huston Tavern' },
              { time: '7:30 PM', activity: 'Lyceum Theatre performance' },
            ],
          },
        ],
      },
    ];
    const result = flattenBrochureDays(days);
    expect(result[0].periods).toHaveLength(3);
    expect(result[0].periods[1].items).toHaveLength(2);
    expect(result[0].periods[2].items[1].time).toBe('7:30 PM');
  });
});
