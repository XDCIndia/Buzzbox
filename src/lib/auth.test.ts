import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-auth-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

import { getDb, resetDbForTests } from './db';
import {
  authenticate,
  createSession,
  createUser,
  deleteUser,
  destroySession,
  ensureAuthTables,
  getUserFromRequest,
  listGoogleLoginRequests,
  listUsers,
  recordGoogleLoginAttempt,
  requireUser,
  resetUserPassword,
  reviewGoogleLoginRequest,
  safeDecodeURIComponent,
  safeRedirectPath,
  seedAdmin,
  updateUserRole,
  validateSession,
} from './auth';

function resetAuthState() {
  ensureAuthTables();
  const db = getDb();
  db.exec('DELETE FROM sessions; DELETE FROM users; DELETE FROM google_login_requests;');
}

beforeEach(() => {
  resetAuthState();
});

after(() => {
  resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('seedAdmin requires AUTH_USER and AUTH_PASS when users table is empty', () => {
  const previousUser = process.env.AUTH_USER;
  const previousPass = process.env.AUTH_PASS;
  delete process.env.AUTH_USER;
  delete process.env.AUTH_PASS;

  assert.throws(() => seedAdmin(), /AUTH_USER must be set/);

  process.env.AUTH_USER = previousUser;
  process.env.AUTH_PASS = previousPass;
});

test('seedAdmin creates initial admin and authenticate succeeds', () => {
  seedAdmin();
  const user = authenticate('admin_test', 'super-secure-pass');
  assert.ok(user);
  assert.equal(user.username, 'admin_test');
  assert.equal(user.role, 'admin');
});

test('session lifecycle validates and invalidates correctly', () => {
  seedAdmin();
  const user = authenticate('admin_test', 'super-secure-pass');
  assert.ok(user);

  const token = createSession(user.id);
  const validated = validateSession(token);
  assert.ok(validated);
  assert.equal(validated.username, user.username);

  destroySession(token);
  assert.equal(validateSession(token), null);
});

test('resetUserPassword invalidates existing sessions (#130)', () => {
  seedAdmin();
  const user = authenticate('admin_test', 'super-secure-pass');
  assert.ok(user);

  const token = createSession(user.id);
  assert.ok(validateSession(token), 'session starts valid');

  resetUserPassword(user.id, 'brand-new-pass-123');
  assert.equal(validateSession(token), null, 'stolen session must die on rotation');
  assert.ok(authenticate('admin_test', 'brand-new-pass-123'), 'new password works');
  assert.equal(authenticate('admin_test', 'super-secure-pass'), null, 'old password stops working');
});

test('seedAdmin password sync invalidates existing sessions (#130)', () => {
  seedAdmin();
  const user = authenticate('admin_test', 'super-secure-pass');
  assert.ok(user);
  const token = createSession(user.id);
  assert.ok(validateSession(token));

  const previousPass = process.env.AUTH_PASS;
  process.env.AUTH_PASS = 'rotated-pass-456';
  try {
    seedAdmin();
  } finally {
    process.env.AUTH_PASS = previousPass;
  }
  assert.equal(validateSession(token), null, 'env rotation must kill sessions too');
  assert.ok(authenticate('admin_test', 'rotated-pass-456'));
});

test('safeRedirectPath only allows same-origin absolute paths (#131)', () => {  assert.equal(safeRedirectPath('/dashboard'), '/dashboard');
  assert.equal(safeRedirectPath('/agents/comms?conv=abc'), '/agents/comms?conv=abc');
  assert.equal(safeRedirectPath('/'), '/');
  assert.equal(safeRedirectPath('//evil.com'), '/');
  assert.equal(safeRedirectPath('//evil.com/phish'), '/');
  assert.equal(safeRedirectPath('https://evil.com'), '/');
  assert.equal(safeRedirectPath('javascript:alert(1)'), '/');
  assert.equal(safeRedirectPath('/\\evil.com'), '/');
  assert.equal(safeRedirectPath('/login?x=1\r\nSet-Cookie: a=b'), '/');
  assert.equal(safeRedirectPath(''), '/');
  assert.equal(safeRedirectPath(undefined), '/');
  assert.equal(safeRedirectPath(null), '/');
});

test('malformed session cookies decode to absent instead of throwing (#149)', () => {
  assert.equal(safeDecodeURIComponent('%'), null);
  assert.equal(safeDecodeURIComponent('%ZZ'), null);
  assert.equal(safeDecodeURIComponent('abc%2'), null);
  assert.equal(safeDecodeURIComponent('valid-token-123'), 'valid-token-123');
  assert.equal(safeDecodeURIComponent('hello%20world'), 'hello world');

  const request = new Request('http://localhost/api/test', {
    headers: { cookie: 'hermes-session=%ZZ' },
  });
  assert.equal(getUserFromRequest(request), null);
  assert.throws(() => requireUser(request), /unauthorized/);
});

test('login session cookie is Lax so OAuth return navigations carry it', async () => {
  // SameSite=Strict withholds the session on the cross-site top-level GET
  // that returns from an external OAuth provider (X authorize -> callback),
  // so the callback sees no session and the flow loops back to /login.
  // Lax still withholds the cookie on all cross-site unsafe requests.
  seedAdmin();
  const { POST } = await import('../app/api/auth/login/route');
  const res = await POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin_test', password: 'super-secure-pass' }),
    }) as never,
  );
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /hermes-session=/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.ok(!/SameSite=Strict/i.test(setCookie), 'must not be Strict');
});

test('login still succeeds with a malformed session cookie present (#149)', async () => {
  seedAdmin();
  const { POST } = await import('../app/api/auth/login/route');
  const res = await POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'hermes-session=%' },
      body: JSON.stringify({ username: 'admin_test', password: 'super-secure-pass' }),
    }) as never,
  );
  assert.equal(res.status, 200);
});

test('requireUser throws on invalid session cookie', () => {
  const request = new Request('http://localhost/api/test', {
    headers: { cookie: 'hermes-session=invalid-token' },
  });

  assert.equal(getUserFromRequest(request), null);
  assert.throws(() => requireUser(request), /unauthorized/);
});

test('x-api-key auth only works when API_KEY is configured and matches', () => {
  const request = new Request('http://localhost/api/test', {
    headers: { 'x-api-key': 'test-api-key' },
  });
  const user = getUserFromRequest(request);
  assert.ok(user);
  assert.equal(user.username, 'api');

  const previous = process.env.API_KEY;
  delete process.env.API_KEY;
  assert.equal(getUserFromRequest(request), null);
  process.env.API_KEY = previous;
});

test('reviewing login requests clears stale pending error metadata', () => {
  recordGoogleLoginAttempt('user@example.com', 'sub-123', 'Google account is not allowed; request pending admin approval');

  let rows = listGoogleLoginRequests();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].attempts, 1);
  assert.match(rows[0].last_error ?? '', /pending admin approval/);

  reviewGoogleLoginRequest('user@example.com', 'approve', 'admin');
  rows = listGoogleLoginRequests();

  assert.equal(rows[0].status, 'approved');
  assert.equal(rows[0].requested_role, 'admin');
  assert.equal(rows[0].attempts, 0);
  assert.equal(rows[0].last_error, null);

  reviewGoogleLoginRequest('user@example.com', 'deny', 'viewer');
  rows = listGoogleLoginRequests();

  assert.equal(rows[0].status, 'denied');
  assert.equal(rows[0].attempts, 0);
  assert.equal(rows[0].last_error, null);
});

test('interleaved last-admin demotes cannot leave zero admins (#165)', () => {
  seedAdmin();
  const first = authenticate('admin_test', 'super-secure-pass');
  assert.ok(first);
  const second = createUser('second_admin', 'second-secure-pass-99', 'admin');

  const db = getDb();
  // Old check-then-act pattern: with two admins, both standalone COUNT
  // checks pass — so without an atomic guard both demotions would commit.
  const countExcludingFirst = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND id != ?").get(first.id) as { c: number }).c;
  const countExcludingSecond = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND id != ?").get(second.id) as { c: number }).c;
  assert.equal(countExcludingFirst, 1, 'first check passes pre-race');
  assert.equal(countExcludingSecond, 1, 'second check passes pre-race');

  // Sequential commits through the new atomic helper: the first demote
  // wins, the second sees the fresh count inside its IMMEDIATE transaction
  // and is refused.
  updateUserRole(first.id, 'editor');
  assert.throws(() => updateUserRole(second.id, 'viewer'), /Cannot remove the last admin/);

  // Failed demote rolls back — the survivor is still an admin.
  const roles = new Map(listUsers().map((u) => [u.username, u.role]));
  assert.equal(roles.get('admin_test'), 'editor');
  assert.equal(roles.get('second_admin'), 'admin');

  // Deleting the last remaining admin is refused and preserves the row.
  assert.throws(() => deleteUser(second.id), /Cannot remove the last admin/);
  assert.equal(listUsers().find((u) => u.username === 'second_admin')?.role, 'admin');

  // Demoting via the legacy `operator` alias is the same non-admin write.
  assert.throws(() => updateUserRole(second.id, 'operator'), /Cannot remove the last admin/);
  assert.equal(listUsers().find((u) => u.username === 'second_admin')?.role, 'admin');

  // Non-admin writes are unaffected: removing the demoted editor succeeds.
  deleteUser(first.id);
  assert.equal(listUsers().filter((u) => u.role === 'admin').length, 1);
});
