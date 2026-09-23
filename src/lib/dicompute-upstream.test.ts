import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #51: when the Dicompute provider answers non-2xx
 * (e.g. a Cloudflare 502 HTML page), askDicompute used to embed the ENTIRE raw
 * response body in the error message, which the Buzz route then surfaced to
 * the UI. It must throw UpstreamProviderError with a concise status-based
 * message instead; the raw body stays server-side (console) only.
 *
 * Dynamic imports AFTER env setup: DICOMPUTE_API_KEY / DICOMPUTE_BASE_URL are
 * captured at module load. No DB is needed -- dicompute.ts is pure fetch. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-dicompute-upstream-'));
process.env.HERMES_DB_PATH = path.join(tempDir, 'hermes-test.db');
process.env.HERMES_STATE_DIR = tempDir;

const UPSTREAM_HTML = `<!DOCTYPE html><html><body><h1>cloudflare</h1>...big error page...${'x'.repeat(5000)}</body></html>`;

// Mutable so each test can pick the upstream failure mode; askDicompute
// always POSTs to the fixed /chat/completions path.
let mode: 'html-502' | 'plain-521' = 'html-502';

const server = http.createServer((req, res) => {
  if (mode === 'html-502') {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end(UPSTREAM_HTML);
  } else {
    res.writeHead(521);
    res.end('web server is down');
  }
});

let dicompute: typeof import('./dicompute');

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  process.env.DICOMPUTE_API_KEY = 'test-key';
  process.env.DICOMPUTE_BASE_URL = `http://127.0.0.1:${port}`;
  dicompute = await import('./dicompute');
});

after(() => {
  server.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const messages = [{ role: 'user' as const, content: 'ping' }];

test('a 502 with an HTML body rejects with UpstreamProviderError and a concise message (#51)', async () => {
  mode = 'html-502';
  await assert.rejects(
    () => dicompute.askDicompute(messages),
    (err: unknown) => {
      assert.ok(err instanceof dicompute.UpstreamProviderError);
      assert.equal(err.status, 502);
      assert.match(err.message, /502 Bad Gateway/);
      assert.match(err.message, /try again later/);
      // The raw provider HTML must never leak into the exposed message.
      assert.ok(!err.message.includes('<html'));
      assert.ok(!err.message.includes('cloudflare'));
      assert.ok(err.message.length < 200, 'message must stay concise');
      return true;
    },
  );
});

test('unknown upstream statuses map to a generic HTTP status message', async () => {
  mode = 'plain-521';
  await assert.rejects(
    () => dicompute.askDicompute(messages),
    (err: unknown) => {
      assert.ok(err instanceof dicompute.UpstreamProviderError);
      assert.equal(err.status, 521);
      assert.match(err.message, /HTTP 521/);
      assert.ok(!err.message.includes('web server is down'), 'body must not leak');
      return true;
    },
  );
});
