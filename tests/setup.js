// Vitest global setup — runs before each test file.
//
// Rate-limit buckets are process-global state. Without a reset between tests,
// handler suites that fire enough requests in a single file will exhaust the
// bucket and start seeing 429s in tests that aren't about rate limiting.
// We reset before each test so every test starts with a full bucket. Tests
// that specifically exercise the rate limiter still see the expected
// fill/drain behaviour because they fire enough requests within a single test.

import { beforeEach } from 'vitest';
import { _resetBucketsForTest } from '../src/lib/server/rate-limit.js';

beforeEach(() => {
  _resetBucketsForTest();
});
