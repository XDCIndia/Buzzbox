import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression test for issue #88: POST /api/buzz must answer 412 (like the X
 * posting path) — not 500 — when the Dicompute LLM connector is unconfigured.
 * A missing credential is a configuration state, not a server fault.
 *
 * Dynamic imports AFTER env setup: DICOMPUTE_API_KEY must be deleted before
 * dicompute.ts is loaded, because it captures the value at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-buzz-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
delete process.env.DICOMPUTE_API_KEY;

let dbm: typeof import('./db');
let buzzPost: typeof import('../app/api/buzz/route')['POST'];
let dicompute: typeof import('./dicompute');

before(async () => {
  dbm = await import('./db');
  const route = await import('../app/api/buzz/route');
  dicompute = await import('./dicompute');
  buzzPost = route.POST;
  dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('askDicompute rejects with MissingConfigError when the key is unset', async () => {
  await assert.rejects(
    () => dicompute.askDicompute([{ role: 'user', content: 'hi' }]),
    (err: unknown) => err instanceof dicompute.MissingConfigError,
  );
});

test('POST /api/buzz returns 412 with a stable body when DICOMPUTE_API_KEY is unset (#88)', async () => {
  const res = await buzzPost(
    new NextRequest('http://localhost/api/buzz', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ message: 'hello buzz' }),
    }),
  );
  assert.equal(res.status, 412);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(String(body.error), /DICOMPUTE_API_KEY is not configured/);
});
