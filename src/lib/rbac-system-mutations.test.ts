import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// NOTE: src/lib/db.ts captures its database path at module load, so every
// module that reads process.env at load time (db, auth, sync) must be
// dynamically imported inside before() AFTER the env vars below are set.
const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-rbac-sys-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const openclawHome = path.join(tempDir, 'openclaw-home');
const stateDir = path.join(tempDir, 'state');

process.env.HERMES_DB_PATH = dbPath;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
process.env.HERMES_OPENCLAW_HOME = openclawHome;
process.env.HERMES_STATE_DIR = stateDir;
process.env.HERMES_ALLOW_POLICY_WRITE = 'true';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type SyncModule = typeof import('./sync');
let dbm: DbModule;
let authm: AuthModule;
let syncMod: SyncModule;
let syncPost: typeof import('../app/api/sync/route')['POST'];
let memoryPolicyPost: typeof import('../app/api/memory-policy/route')['POST'];
let memoryAlertPolicyPost: typeof import('../app/api/memory-alert-policy/route')['POST'];
let syncSessionsPost: typeof import('../app/api/chat/sync-sessions/route')['POST'];
let outreachPausePost: typeof import('../app/api/outreach/pause/route')['POST'];

const ADMIN = { 'x-api-key': 'test-api-key' };
let viewerCookie: string;
let editorCookie: string;

type PostHandler = (req: never) => Promise<Response>;

function post<H extends PostHandler>(handler: H, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const req = new Request('http://localhost/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(req as never);
}

// tsx emits CJS here, so dynamic imports wrap exports under `.default`.
async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<typeof import('./db')>('./db');
  authm = await imp<typeof import('./auth')>('./auth');
  syncPost = (await imp<typeof import('../app/api/sync/route')>('../app/api/sync/route')).POST;
  memoryPolicyPost = (await imp<typeof import('../app/api/memory-policy/route')>('../app/api/memory-policy/route')).POST;
  memoryAlertPolicyPost = (await imp<typeof import('../app/api/memory-alert-policy/route')>('../app/api/memory-alert-policy/route')).POST;
  syncSessionsPost = (await imp<typeof import('../app/api/chat/sync-sessions/route')>('../app/api/chat/sync-sessions/route')).POST;
  outreachPausePost = (await imp<typeof import('../app/api/outreach/pause/route')>('../app/api/outreach/pause/route')).POST;
  syncMod = await imp<typeof import('./sync')>('./sync');

  authm.ensureAuthTables();
  dbm.getDb().exec("DELETE FROM sessions; DELETE FROM users WHERE username IN ('rbac_viewer','rbac_editor');");
  const viewer = authm.createUser('rbac_viewer', 'viewer-password-123', 'viewer');
  viewerCookie = `hermes-session=${authm.createSession(viewer.id)}`;
  const editor = authm.createUser('rbac_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
});

after(() => {
  syncMod.stopSync();
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('POST /api/sync: unauthenticated 401, viewer 403, editor 403, admin allowed', async () => {
  assert.equal((await post(syncPost)).status, 401);
  assert.equal((await post(syncPost, undefined, { cookie: viewerCookie })).status, 403);
  assert.equal((await post(syncPost, undefined, { cookie: editorCookie })).status, 403);

  const res = await post(syncPost, undefined, ADMIN);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('POST /api/memory-policy: viewer/editor denied before any file write; admin writes policy', async () => {
  const policyFile = path.join(openclawHome, 'health', 'memory-policy.json');
  const payload = { decay_half_life_days: 30 };

  assert.equal((await post(memoryPolicyPost, payload)).status, 401);

  const viewerRes = await post(memoryPolicyPost, payload, { cookie: viewerCookie });
  assert.equal(viewerRes.status, 403);
  assert.equal(existsSync(policyFile), false, 'policy file must not be created for viewer');

  assert.equal((await post(memoryPolicyPost, payload, { cookie: editorCookie })).status, 403);
  assert.equal(existsSync(policyFile), false, 'policy file must not be created for editor');

  const adminRes = await post(memoryPolicyPost, payload, ADMIN);
  assert.equal(adminRes.status, 200);
  assert.equal((await adminRes.json()).ok, true);
  assert.equal(existsSync(policyFile), true, 'policy file should exist after admin write');
});

test('POST /api/memory-alert-policy: viewer/editor denied; admin writes policy', async () => {
  const policyFile = path.join(openclawHome, 'health', 'memory-alert-policy.json');
  const payload = { window_days: 14 };

  assert.equal((await post(memoryAlertPolicyPost, payload, { cookie: viewerCookie })).status, 403);
  assert.equal((await post(memoryAlertPolicyPost, payload, { cookie: editorCookie })).status, 403);
  assert.equal(existsSync(policyFile), false);

  const adminRes = await post(memoryAlertPolicyPost, payload, ADMIN);
  assert.equal(adminRes.status, 200);
  assert.equal(existsSync(policyFile), true);
});

test('POST /api/chat/sync-sessions: viewer/editor denied without DB writes; admin allowed', async () => {
  const countMessages = (): number =>
    (dbm.getDb().prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;

  assert.equal((await post(syncSessionsPost)).status, 401);

  const beforeCount = countMessages();
  assert.equal((await post(syncSessionsPost, undefined, { cookie: viewerCookie })).status, 403);
  assert.equal((await post(syncSessionsPost, undefined, { cookie: editorCookie })).status, 403);
  assert.equal(countMessages(), beforeCount, 'no messages may be imported for denied roles');

  const adminRes = await post(syncSessionsPost, undefined, ADMIN);
  assert.equal(adminRes.status, 200);
  const body = await adminRes.json();
  assert.equal(body.imported, 0);
});

test('POST /api/outreach/pause: denial happens before flag/activity side effects', async () => {
  const flagPath = path.join(stateDir, 'sending-paused.flag');
  const activityCount = (): number =>
    (dbm.getDb().prepare("SELECT COUNT(*) as c FROM activity_log WHERE action LIKE 'outreach_%'").get() as { c: number }).c;

  const req = (body: unknown, headers: Record<string, string> = {}): NextRequest =>
    new NextRequest(new URL('http://localhost/api/outreach/pause'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;

  assert.equal((await outreachPausePost(req({ paused: true }))).status, 401);

  const beforeCount = activityCount();
  assert.equal((await outreachPausePost(req({ paused: true }, { cookie: viewerCookie }))).status, 403);
  assert.equal((await outreachPausePost(req({ paused: true }, { cookie: editorCookie }))).status, 403);
  assert.equal(activityCount(), beforeCount, 'activity_log must be unchanged for denied roles');
  assert.equal(existsSync(flagPath), false, 'pause flag must not be created for denied roles');

  const adminRes = await outreachPausePost(req({ paused: true }, ADMIN));
  assert.equal(adminRes.status, 200);
  assert.equal((await adminRes.json()).paused, true);
  assert.equal(existsSync(flagPath), true);

  const resumeRes = await outreachPausePost(req({ paused: false }, ADMIN));
  assert.equal(resumeRes.status, 200);
  assert.equal(existsSync(flagPath), false);
});
