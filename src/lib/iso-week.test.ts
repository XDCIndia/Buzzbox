import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getISOWeek } from './queries';

/* Tests for ISO-8601 week bucketing (#61).
 *
 * The old implementation mixed UTC-parsed dates with LOCAL getters, so on
 * non-UTC servers boundary dates could land in the wrong week/year. The
 * fixed version computes entirely in UTC — every expectation below is a
 * verified ISO-8601 fact, independent of the machine running the tests. */

test('mid-week date maps to the expected ISO week', () => {
  // 2026-01-15 is a Thursday → W03 of 2026.
  assert.deepEqual(getISOWeek(new Date('2026-01-15')), { year: 2026, week: 3 });
});

test('Friday Jan 1 belongs to the previous ISO year (W53 of 2026)', () => {
  // 2027-01-01 is a Friday; ISO assigns it to 2026-W53.
  assert.deepEqual(getISOWeek(new Date('2027-01-01')), { year: 2026, week: 53 });
});

test('Thursday Jan 1 starts ISO week 1 of its own year', () => {
  // 2026-01-01 is a Thursday.
  assert.deepEqual(getISOWeek(new Date('2026-01-01')), { year: 2026, week: 1 });
});

test('Saturday Jan 1 belongs to the previous ISO year (W52 of 2027)', () => {
  // 2028-01-01 is a Saturday; its ISO week's Thursday (2027-12-30) is in 2027.
  assert.deepEqual(getISOWeek(new Date('2028-01-01')), { year: 2027, week: 52 });
});

test('Monday Jan 1 starts ISO week 1', () => {
  // 2029-01-01 is a Monday.
  assert.deepEqual(getISOWeek(new Date('2029-01-01')), { year: 2029, week: 1 });
});

test('year-end Thursday lands in W53 of its own year', () => {
  // 2026-12-31 is a Thursday.
  assert.deepEqual(getISOWeek(new Date('2026-12-31')), { year: 2026, week: 53 });
});

test('Monday and Sunday of the same calendar week share one ISO bucket', () => {
  // Mon 2026-01-05 .. Sun 2026-01-11 → W02 of 2026.
  assert.deepEqual(getISOWeek(new Date('2026-01-05')), { year: 2026, week: 2 });
  assert.deepEqual(getISOWeek(new Date('2026-01-11')), { year: 2026, week: 2 });
});

test('year label follows the ISO week-numbering year, not the calendar year', () => {
  // The whole Sat 2027-01-02 .. Sun 2027-01-03 tail of 2026-W53 must be
  // labeled 2026 (its Thursday, 2026-12-30, is in 2026).
  assert.deepEqual(getISOWeek(new Date('2027-01-02')), { year: 2026, week: 53 });
  assert.deepEqual(getISOWeek(new Date('2027-01-03')), { year: 2026, week: 53 });
});

test('deterministic regardless of server timezone', () => {
  if (process.platform === 'win32') return; // TZ switching is POSIX-only
  const d = new Date('2027-01-01T00:00:00Z'); // Friday, ISO 2026-W53
  const before = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
    const plus14 = getISOWeek(d);
    process.env.TZ = 'Pacific/Midway'; // UTC-11
    const minus11 = getISOWeek(d);
    assert.deepEqual(plus14, { year: 2026, week: 53 });
    assert.deepEqual(minus11, { year: 2026, week: 53 });
  } finally {
    process.env.TZ = before;
  }
});
