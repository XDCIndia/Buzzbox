import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #170: creating, demoting, resetting passwords,
 * deleting users, and approving/denying OAuth login requests wrote no audit
 * trail — the highest-privilege actions were invisible to forensics.
 *
 * Each privileged mutation must append one audit_log row with actor, action,
 * and target; failed mutations must not. Password material must never land
 * in the audit detail.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-user-audit-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type UsersRoute = typeof import('../app/api/users/route');
type RequestsRoute = typeof import('../app/api/users/requests/route');
let dbm: DbModule;
let authm: AuthModule;
let usersPost: UsersRoute['POST'];
let usersPatch: UsersRoute['PATCH'];
let usersDelete: UsersRoute['DELETE'];
let requestsPatch: RequestsRoute['PATCH'];
let db: ReturnType<DbModule['getDb']>;
let adminCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

interface AuditRow {
  actor_username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
}

function auditRows(action: string): AuditRow[] {
  return db.prepare('SELECT actor_username, action, target, detail FROM audit_log WHERE action = ? ORDER BY id ASC').all(action) as AuditRow[];
}

function call(
  handler: (req: never) => Promise<Response>,
  url: string,
  body: unknown,
): Promise<Response> {
  return handler(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify(body),
    }) as never,
  );
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  const users = await imp<UsersRoute>('../app/api/users/route');
  usersPost = users.POST;
  usersPatch = users.PATCH;
  usersDelete = users.DELETE;
  requestsPatch = (await imp<RequestsRoute>('../app/api/users/requests/route')).PATCH;
  db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const admin = authm.createUser('audit_admin', 'audit-admin-pass-99', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;
  // Fresh temp DB: audit_log is created lazily by the first logAudit call.
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('user create appends a user.create audit row (#170)', async () => {
  const res = await call(usersPost, 'http://localhost/api/users', {
    username: 'audit_editor',
    password: 'audit-editor-pass-99',
    role: 'editor',
  });
  assert.equal(res.status, 200);

  const rows = auditRows('user.create');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_username, 'audit_admin');
  assert.equal(rows[0].target, 'user:audit_editor');
  const detail = JSON.parse(rows[0].detail ?? '{}') as { role?: string };
  assert.equal(detail.role, 'editor');
});

test('role change and password reset each append their own audit row (#170)', async () => {
  const target = (authm.listUsers().find((u) => u.username === 'audit_editor') as { id: number }).id;

  const roleRes = await call(usersPatch, 'http://localhost/api/users', { id: target, role: 'viewer' });
  assert.equal(roleRes.status, 200);
  const roleRows = auditRows('user.update_role');
  assert.equal(roleRows.length, 1);
  assert.equal(roleRows[0].actor_username, 'audit_admin');
  assert.equal(roleRows[0].target, `user:${target}`);
  assert.equal((JSON.parse(roleRows[0].detail ?? '{}') as { role?: string }).role, 'viewer');

  const passRes = await call(usersPatch, 'http://localhost/api/users', { id: target, password: 'audit-rotated-pass-99' });
  assert.equal(passRes.status, 200);
  const passRows = auditRows('user.reset_password');
  assert.equal(passRows.length, 1);
  assert.equal(passRows[0].target, `user:${target}`);
  assert.doesNotMatch(passRows[0].detail ?? '', /audit-rotated-pass-99/, 'password material must never be audited');
});

test('user delete appends a user.delete audit row (#170)', async () => {
  const target = (authm.listUsers().find((u) => u.username === 'audit_editor') as { id: number }).id;
  const res = await call(usersDelete, 'http://localhost/api/users', { id: target });
  assert.equal(res.status, 200);

  const rows = auditRows('user.delete');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_username, 'audit_admin');
  assert.equal(rows[0].target, `user:${target}`);
  const detail = JSON.parse(rows[0].detail ?? '{}') as { username?: string };
  assert.equal(detail.username, 'audit_editor');
});

test('OAuth login-request approve and deny are audited (#170)', async () => {
  const approveRes = await call(requestsPatch, 'http://localhost/api/users/requests', {
    email: 'approve-me@example.com',
    action: 'approve',
    role: 'editor',
  });
  assert.equal(approveRes.status, 200);
  const denyRes = await call(requestsPatch, 'http://localhost/api/users/requests', {
    email: 'deny-me@example.com',
    action: 'deny',
  });
  assert.equal(denyRes.status, 200);

  const rows = auditRows('user.login_request.review');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target, 'login-request:approve-me@example.com');
  assert.equal((JSON.parse(rows[0].detail ?? '{}') as { action?: string }).action, 'approve');
  assert.equal(rows[1].target, 'login-request:deny-me@example.com');
  assert.equal((JSON.parse(rows[1].detail ?? '{}') as { action?: string }).action, 'deny');
});

test('failed user mutations append no audit rows (#170)', async () => {
  const createsBefore = auditRows('user.create').length;
  // Duplicate username answers 409 AFTER validation passes but the insert
  // fails — no audit row for a user that was never created.
  const dupRes = await call(usersPost, 'http://localhost/api/users', {
    username: 'audit_admin',
    password: 'some-other-pass-99',
    role: 'editor',
  });
  assert.equal(dupRes.status, 409);
  assert.equal(auditRows('user.create').length, createsBefore);

  const deletesBefore = auditRows('user.delete').length;
  const missingRes = await call(usersDelete, 'http://localhost/api/users', { id: 999999 });
  assert.equal(missingRes.status, 404);
  assert.equal(auditRows('user.delete').length, deletesBefore);
});
