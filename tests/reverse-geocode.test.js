import { describe, test, expect, vi, beforeEach } from 'vitest';

// Stub fs at module load so the cache files don't poison test state.
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(() => { throw new Error('no file'); }),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock('fs', () => fsMock);
vi.mock('node:fs', () => fsMock);

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test('returns formatted address from Nominatim reverse response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        display_name: 'Sleeping Bear Dunes National Lakeshore, Empire Township, Leelanau County, Michigan, 49630, United States',
        address: {
          tourism: 'Sleeping Bear Dunes National Lakeshore',
          road: 'Front Street',
          house_number: '9922',
          city: 'Empire',
          state: 'Michigan',
          postcode: '49630',
        },
      }),
    }));

    const { reverseGeocode } = await import('../src/lib/server/data.js');
    const address = await reverseGeocode([44.88, -86.05]);
    expect(address).toBe('9922 Front Street, Empire, Michigan 49630');
  });

  test('falls back to display_name when structured fields are sparse', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        display_name: 'Some Trailhead, Wilderness Area, Montana',
        address: { country: 'United States' },
      }),
    }));

    const { reverseGeocode } = await import('../src/lib/server/data.js');
    const address = await reverseGeocode([45.0, -110.0]);
    expect(address).toBe('Some Trailhead, Wilderness Area, Montana');
  });

  test('returns null on HTTP error', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { reverseGeocode } = await import('../src/lib/server/data.js');
    expect(await reverseGeocode([44.88, -86.05])).toBeNull();
  });

  test('hits cache on second call for same coords', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        display_name: 'X, Y, Z',
        address: { road: 'Main', city: 'Springfield', state: 'IL', postcode: '12345' },
      }),
    }));
    global.fetch = f;

    const { reverseGeocode } = await import('../src/lib/server/data.js');
    // Use distinct coords so this isn't polluted by prior tests' cache.
    await reverseGeocode([41.55555, -89.55555]);
    await reverseGeocode([41.55555, -89.55555]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('returns null when coords are not a 2-element finite array', async () => {
    const { reverseGeocode } = await import('../src/lib/server/data.js');
    expect(await reverseGeocode(null)).toBeNull();
    expect(await reverseGeocode([])).toBeNull();
    expect(await reverseGeocode([44.88])).toBeNull();
    expect(await reverseGeocode([NaN, -86])).toBeNull();
  });
});

describe('formatStructuredAddress', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('builds full address from all structured fields', async () => {
    const { formatStructuredAddress } = await import('../src/lib/server/data.js');
    const result = formatStructuredAddress(
      { house_number: '123', road: 'Main St', city: 'Anytown', state: 'OH', postcode: '44001' },
      'fallback',
    );
    expect(result).toBe('123 Main St, Anytown, OH 44001');
  });

  test('uses town when city is missing', async () => {
    const { formatStructuredAddress } = await import('../src/lib/server/data.js');
    const result = formatStructuredAddress(
      { road: 'Oak Ave', town: 'Smallville', state: 'KS' },
      'fallback',
    );
    expect(result).toBe('Oak Ave, Smallville, KS');
  });

  test('falls back to display_name when addr is null', async () => {
    const { formatStructuredAddress } = await import('../src/lib/server/data.js');
    expect(formatStructuredAddress(null, 'the fallback')).toBe('the fallback');
  });

  test('falls back to display_name when structured fields are too sparse', async () => {
    const { formatStructuredAddress } = await import('../src/lib/server/data.js');
    // No road or street-level field — can't build a usable address
    expect(formatStructuredAddress({ country: 'US' }, 'sparse fallback')).toBe('sparse fallback');
  });

  test('returns null when addr is null and no fallback', async () => {
    const { formatStructuredAddress } = await import('../src/lib/server/data.js');
    expect(formatStructuredAddress(null, undefined)).toBeNull();
  });
});
