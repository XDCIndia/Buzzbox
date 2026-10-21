import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDicomputeBaseUrl } from './dicompute';

/* Regression guard for issue #225 follow-up: the documented base URL
 * `https://api.dicompute.ai/v1` 308-redirects to `https://dicompute.ai/openai/v1`.
 * The hop is cross-origin, and Authorization is a CORS non-wildcard header, so
 * Node's fetch strips it -- the provider then answers `401 invalid api key` even
 * for a valid key. The legacy host must be rewritten to the canonical endpoint. */

const CANONICAL = 'https://dicompute.ai/openai/v1';

test('the legacy api.dicompute.ai/v1 host is rewritten to the canonical endpoint', () => {
  assert.equal(normalizeDicomputeBaseUrl('https://api.dicompute.ai/v1'), CANONICAL);
  assert.equal(normalizeDicomputeBaseUrl('https://api.dicompute.ai/v1/'), CANONICAL);
  assert.equal(normalizeDicomputeBaseUrl('https://api.dicompute.ai'), CANONICAL);
  assert.equal(normalizeDicomputeBaseUrl('  https://api.dicompute.ai/v1  '), CANONICAL);
});

test('an unset base URL falls back to the canonical endpoint', () => {
  assert.equal(normalizeDicomputeBaseUrl(undefined), CANONICAL);
  assert.equal(normalizeDicomputeBaseUrl(''), CANONICAL);
  assert.equal(normalizeDicomputeBaseUrl('   '), CANONICAL);
});

test('explicit endpoints are preserved with only trailing slashes removed', () => {
  assert.equal(normalizeDicomputeBaseUrl(CANONICAL), CANONICAL);
  assert.equal(normalizeDicomputeBaseUrl(`${CANONICAL}/`), CANONICAL);
  assert.equal(
    normalizeDicomputeBaseUrl('http://127.0.0.1:11434/v1/'),
    'http://127.0.0.1:11434/v1',
  );
});
