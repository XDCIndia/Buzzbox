import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #86: the middleware's CSRF origin check compared
 * the Origin/Referer verbatim against request.nextUrl.origin — which Next
 * normalizes to localhost — so a browser on http://127.0.0.1:3010 403'd every
 * mutating request. Loopback spellings are equivalent; cross-site origins
 * must still be rejected.
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-proxy-csrf-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
delete process.env.PUBLIC_BASE_URL;
delete process.env.X_ACCESS_TOKEN;

let proxy: typeof import('../proxy')['proxy'];

before(async () => {
  await import('./db');
  proxy = (await import('../proxy')).proxy;
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function mutatingRequest(opts: { origin?: string; referer?: string; url?: string; host?: string }): NextRequest {
  const headers: Record<string, string> = {
    cookie: 'hermes-session=test-session-token',
    host: opts.host ?? 'localhost:3010',
  };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.referer) headers.referer = opts.referer;
  return new NextRequest(opts.url ?? 'http://localhost:3010/api/content', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ id: 'x' }),
  });
}

test('browser on 127.0.0.1 talking to localhost-normalized origin passes (#86)', () => {
  const res = proxy(mutatingRequest({ origin: 'http://127.0.0.1:3010', host: '127.0.0.1:3010' }));
  assert.notEqual(res.status, 403);
});

test('browser on localhost with referer from 127.0.0.1 passes (#86)', () => {
  const res = proxy(mutatingRequest({ referer: 'http://127.0.0.1:3010/approvals' }));
  assert.notEqual(res.status, 403);
});

test('cross-site origin is still rejected', () => {
  const res = proxy(mutatingRequest({ origin: 'http://evil.example:3010' }));
  assert.equal(res.status, 403);
});

test('cross-site referer is still rejected', () => {
  const res = proxy(mutatingRequest({ referer: 'http://evil.example:3010/approvals' }));
  assert.equal(res.status, 403);
});

test('different port on the same host is NOT treated as same origin', () => {
  const res = proxy(mutatingRequest({ origin: 'http://localhost:3011' }));
  assert.equal(res.status, 403);
});

test('mutating request with neither origin nor referer is still rejected', () => {
  const res = proxy(mutatingRequest({}));
  assert.equal(res.status, 403);
});

test('https production origin vs http is not equivalent', () => {
  const res = proxy(mutatingRequest({ origin: 'https://localhost:3010' }));
  assert.equal(res.status, 403);
});

test('GET requests remain exempt from the origin check', () => {
  const res = proxy(
    new NextRequest('http://localhost:3010/api/content', {
      headers: { cookie: 'hermes-session=test-session-token', host: 'localhost:3010' },
    }),
  );
  assert.notEqual(res.status, 403);
});
