import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { rateLimit, resetRateLimits } from './rate-limit';

beforeEach(() => {
  resetRateLimits();
});

afterEach(() => {
  resetRateLimits();
});

function fixedClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

test('allows attempts up to max within the window', () => {
  const clock = fixedClock();
  const opts = { max: 3, windowMs: 60_000, now: clock.now };

  assert.equal(rateLimit('k', opts).allowed, true);
  assert.equal(rateLimit('k', opts).allowed, true);
  assert.equal(rateLimit('k', opts).allowed, true);
});

test('blocks the attempt after max is exceeded', () => {
  const clock = fixedClock();
  const opts = { max: 2, windowMs: 60_000, now: clock.now };
  rateLimit('k', opts);
  rateLimit('k', opts);
  const result = rateLimit('k', opts);

  assert.equal(result.allowed, false);
  assert.equal(result.count, 3);
});

test('reports retryAfterMs until the window resets', () => {
  const clock = fixedClock();
  const opts = { max: 1, windowMs: 60_000, now: clock.now };
  rateLimit('k', opts);
  clock.advance(20_000);
  const result = rateLimit('k', opts);

  assert.equal(result.allowed, false);
  assert.equal(result.retryAfterMs, 40_000);
});

test('window resets after windowMs elapses', () => {
  const clock = fixedClock();
  const opts = { max: 1, windowMs: 60_000, now: clock.now };
  assert.equal(rateLimit('k', opts).allowed, true);
  clock.advance(60_000);
  const next = rateLimit('k', opts);

  assert.equal(next.allowed, true);
  assert.equal(next.count, 1);
});

test('keys are isolated from each other', () => {
  const clock = fixedClock();
  const opts = { max: 1, windowMs: 60_000, now: clock.now };
  assert.equal(rateLimit('a', opts).allowed, true);
  assert.equal(rateLimit('b', opts).allowed, true);
  assert.equal(rateLimit('a', opts).allowed, false);
});

test('blocked attempts still count toward the window (no lock-extension)', () => {
  const clock = fixedClock();
  const opts = { max: 1, windowMs: 60_000, now: clock.now };
  rateLimit('k', opts);
  rateLimit('k', opts);
  rateLimit('k', opts);
  clock.advance(59_999);
  // Window started at first attempt; one ms later it must reset.
  clock.advance(1);
  assert.equal(rateLimit('k', opts).allowed, true);
});
