import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #136: GET /api/deploy-status exposed service
 * names, filesystem paths, pids, log tails, and validator output to any
 * viewer. System surfaces require the manage_system capability (admin-only),
 * like the sibling system routes.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-deploy-status-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
let dbm: DbModule;
let authm: AuthModule;
let deployGet: typeof import('../app/api/deploy-status/route')['GET'];
let viewerCookie: string;
let editorCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  deployGet = (await imp<typeof import('../app/api/deploy-status/route')>('../app/api/deploy-status/route')).GET;

  authm.ensureAuthTables();
  dbm.getDb().exec("DELETE FROM sessions; DELETE FROM users WHERE username LIKE 'ds_%';");
  const viewer = authm.createUser('ds_viewer', 'viewer-password-123', 'viewer');
  viewerCookie = `hermes-session=${authm.createSession(viewer.id)}`;
  const editor = authm.createUser('ds_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function get(headers: Record<string, string> = {}): Promise<Response> {
  return deployGet(new Request('http://localhost/api/deploy-status', { headers }) as never);
}

test('GET /api/deploy-status rejects unauthenticated, viewer, and editor (#136)', async () => {
  assert.equal((await get()).status, 401);
  assert.equal((await get({ cookie: viewerCookie })).status, 403);
  assert.equal((await get({ cookie: editorCookie })).status, 403);
});

test('GET /api/deploy-status serves admins (#136)', async () => {
  const res = await get({ 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.service, 'service block present');
  assert.ok(body.deploy, 'deploy block present');
});
