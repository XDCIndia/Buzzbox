import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #100: HERMES_HOST_LOCK is enforced against the
 * client-controlled Host header. Two defects lived here:
 *  1. `host.split(':')[0]` mangled bracketed IPv6 (`[::1]:3000` -> `'['`),
 *     rejecting genuine IPv6 loopback.
 *  2. Nothing documented that the lock is best-effort (spoofable) and that
 *     the real boundary is the listen address + firewall.
 *
 * The proxy answers 403 when the lock rejects, so an unauthenticated GET to
 * /api/overview discriminates cleanly: 403 = lock rejected, 401 = lock
 * passed (then stopped by the API auth gate).
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-host-lock-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

let proxy: typeof import('../proxy')['proxy'];
let savedHostLock: string | undefined;

before(async () => {
  await import('./db');
  proxy = (await import('../proxy')).proxy;
  savedHostLock = process.env.HERMES_HOST_LOCK;
});

after(() => {
  if (savedHostLock === undefined) delete process.env.HERMES_HOST_LOCK;
  else process.env.HERMES_HOST_LOCK = savedHostLock;
  rmSync(tempDir, { recursive: true, force: true });
});

function apiGet(host: string): number {
  const res = proxy(
    new NextRequest('http://localhost:3010/api/overview', {
      headers: { host },
    }),
  );
  return res.status;
}

test('local mode accepts localhost and 127.0.0.1 (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'local';
  assert.equal(apiGet('localhost:3010'), 401);
  assert.equal(apiGet('127.0.0.1:3010'), 401);
});

test('local mode accepts IPv6 loopback spellings (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'local';
  assert.equal(apiGet('[::1]:3010'), 401);
  assert.equal(apiGet('[::1]'), 401);
  assert.equal(apiGet('::1'), 401);
});

test('local mode normalizes hostname case (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'local';
  assert.equal(apiGet('LOCALHOST:3010'), 401);
});

test('local mode still rejects non-local hosts (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'local';
  assert.equal(apiGet('evil.example'), 403);
  assert.equal(apiGet('evil.example:3010'), 403);
  assert.equal(apiGet(''), 403);
});

test('local mode keeps the documented Tailscale allowance (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'local';
  assert.equal(apiGet('100.64.0.1:3010'), 401);
  assert.equal(apiGet('myhost.ts.net'), 401);
});

test('allowlist mode is case-insensitive and strips ports (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'Example.COM, other.test';
  assert.equal(apiGet('example.com'), 401);
  assert.equal(apiGet('other.test:3000'), 401);
  assert.equal(apiGet('evil.example'), 403);
});

test('off mode disables the lock (#100)', () => {
  process.env.HERMES_HOST_LOCK = 'off';
  assert.equal(apiGet('evil.example'), 401);
});
