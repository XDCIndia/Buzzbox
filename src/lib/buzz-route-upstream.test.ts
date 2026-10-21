import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Issue #225: when the LLM provider is genuinely down (intermittent Cloudflare
 * 502s), POST /api/buzz must answer a clean 502 with `retryable: true` so the
 * chat UI can offer a Retry action instead of rendering a permanent crash
 * bubble -- never the provider's raw HTML.
 *
 * Dynamic imports AFTER env setup: DICOMPUTE_* are captured when dicompute.ts
 * loads. Attempts are capped at 1 so the test stays fast. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-buzz-upstream-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

const UPSTREAM_HTML = `<!DOCTYPE html><html><body><h1>cloudflare</h1>${'x'.repeat(5000)}</body></html>`;

let dicomputeHits = 0;

const server = http.createServer((_req, res) => {
  dicomputeHits += 1;
  res.writeHead(502, { 'Content-Type': 'text/html' });
  res.end(UPSTREAM_HTML);
});

let dbm: typeof import('./db');
let buzzPost: typeof import('../app/api/buzz/route')['POST'];

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  process.env.DICOMPUTE_API_KEY = 'test-key';
  process.env.DICOMPUTE_BASE_URL = `http://127.0.0.1:${port}/openai/v1`;
  process.env.DICOMPUTE_MAX_ATTEMPTS = '1';
  process.env.DICOMPUTE_RETRY_BACKOFF_MS = '0';
  delete process.env.OLLAMA_BASE_URL;

  dbm = await import('./db');
  const route = await import('../app/api/buzz/route');
  buzzPost = route.POST;
  dbm.getDb();
});

after(() => {
  server.close();
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

async function post(message: string) {
  return buzzPost(
    new NextRequest('http://localhost/api/buzz', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ message }),
    }),
  );
}

test('POST /api/buzz answers 502 + retryable on a persistent upstream failure (#225)', async () => {
  const res = await post('What is Buzzbox?');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.retryable, true, 'the UI needs to know a retry can help');
  assert.match(String(body.error), /502 Bad Gateway/);
  assert.match(String(body.error), /try again later/);
  assert.ok(!String(body.error).includes('<html'), 'provider HTML must not leak');
  assert.ok(String(body.error).length < 200, 'message must stay concise');
});

test('the failing provider is called exactly once when attempts are capped at 1', () => {
  assert.equal(dicomputeHits, 1);
});
