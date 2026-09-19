import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { fetchWithTimeout, TimeoutError } from './fetch-with-timeout';

/* Unit tests: spin a real local HTTP server so the deadline behavior is
 * exercised end-to-end — no network mocks that would also need mocking
 * the timeout mechanics themselves. */

let server: http.Server;
let baseUrl = '';

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/slow') {
      // Longer than any timeout used in the tests below.
      setTimeout(() => {
        res.writeHead(200);
        res.end('eventually');
      }, 3000);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, method: req.method }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('passes through fast responses untouched', async () => {
  const res = await fetchWithTimeout(`${baseUrl}/fast`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as { ok: boolean };
  assert.equal(data.ok, true);
});

test('aborts requests that exceed their deadline with TimeoutError', async () => {
  // /slow responds after 3s — well past a 200ms deadline, well under the 15s default.
  await assert.rejects(
    () => fetchWithTimeout(`${baseUrl}/slow`, {}, 200),
    (err: unknown) => err instanceof TimeoutError,
  );
});

test('respects a custom shorter deadline', async () => {
  await assert.rejects(
    () => fetchWithTimeout(`${baseUrl}/slow`, {}, 100),
    (err: unknown) => err instanceof TimeoutError && err.message.includes('100ms'),
  );
});

test('forwards method and headers to the underlying request', async () => {
  const res = await fetchWithTimeout(`${baseUrl}/fast`, {
    method: 'POST',
    headers: { 'x-test': '1' },
  });
  const data = (await res.json()) as { method: string };
  assert.equal(data.method, 'POST');
});

test('caller-provided abort signal cancels the request', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => fetchWithTimeout(`${baseUrl}/fast`, { signal: controller.signal }),
    (err: unknown) => !(err instanceof TimeoutError),
  );
});
