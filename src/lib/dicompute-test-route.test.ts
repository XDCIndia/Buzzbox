import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// NOTE: src/lib/db.ts captures its database path at module load, and
// dicompute.ts captures DICOMPUTE_API_KEY at load, so env vars must be set
// here and every module dynamically imported inside before() AFTER them.

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-dicompute-test-route-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
// Unset so askDicompute throws MissingConfigError before any network call.
delete process.env.DICOMPUTE_API_KEY;

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
let dbm: DbModule;
let authm: AuthModule;
let getRoute: typeof import('../app/api/dicompute-test/route')['GET'];
let resetRateLimits: typeof import('./rate-limit')['resetRateLimits'];

const ADMIN = { 'x-api-key': 'test-api-key' };
let viewerCookie: string;
let editorCookie: string;

function get(headers: Record<string, string> = {}): Promise<Response> {
  const req = new Request('http://localhost/api/dicompute-test', { headers });
  return getRoute(req as never);
}

// tsx emits CJS here, so dynamic imports wrap exports under `.default`.
async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  getRoute = (await imp<typeof import('../app/api/dicompute-test/route')>('../app/api/dicompute-test/route')).GET;
  resetRateLimits = (await imp<typeof import('./rate-limit')>('./rate-limit')).resetRateLimits;

  authm.ensureAuthTables();
  dbm.getDb().exec("DELETE FROM sessions; DELETE FROM users WHERE username IN ('dctest_viewer','dctest_editor');");
  const viewer = authm.createUser('dctest_viewer', 'viewer-password-123', 'viewer');
  viewerCookie = `hermes-session=${authm.createSession(viewer.id)}`;
  const editor = authm.createUser('dctest_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
  resetRateLimits();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('GET /api/dicompute-test rejects unauthenticated callers with 401 (#99)', async () => {
  const res = await get();
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success ?? undefined, undefined);
  assert.match(String(body.error), /Authentication required/);
});

test('GET /api/dicompute-test rejects viewer and editor with 403 (#99)', async () => {
  assert.equal((await get({ cookie: viewerCookie })).status, 403);
  assert.equal((await get({ cookie: editorCookie })).status, 403);
});

test('GET /api/dicompute-test answers 412 with guidance when the provider key is unset (#99)', async () => {
  const res = await get(ADMIN);
  assert.equal(res.status, 412);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.match(String(body.error), /DICOMPUTE_API_KEY is not configured/);
});

test('GET /api/dicompute-test rate-limits callers with 429 and Retry-After (#99)', async () => {
  resetRateLimits();
  let last: Response | null = null;
  for (let i = 0; i < 11; i++) {
    last = await get(ADMIN);
  }
  assert.equal(last!.status, 429);
  assert.ok(last!.headers.get('retry-after'), '429 must carry a Retry-After header');
  const body = await last!.json();
  assert.equal(body.success, false);
});
