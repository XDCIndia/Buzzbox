import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Credential-isolation regression tests for the X OAuth integration.
 *
 * The original implementation resolved posting credentials as
 *   1. current user's connection -> 2. ANY connected account -> 3. env,
 * so a user with no X connection silently posted AS another user's X
 * account (and could refresh/invalidate that connection as a side effect).
 * These tests prove the fixed order — own connection, then the explicitly
 * shared X_ACCESS_TOKEN env sender, then 412 — and that no cross-user
 * token use, refresh, or deletion can occur.
 *
 * No real X credentials: fetch is mocked. Dynamic imports AFTER env setup
 * (db.ts captures its path at module load). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-x-isolation-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
process.env.X_CLIENT_ID = 'test-client-id';
process.env.X_CLIENT_SECRET = 'test-client-secret';
process.env.X_REDIRECT_URI = 'https://tunnel.example.test/api/auth/x/callback';
delete process.env.X_ACCESS_TOKEN;

type ConnModule = typeof import('./x-connections');
type AuthModule = typeof import('./auth');
type PublishModule = typeof import('./publish-to-x');
type DbModule = typeof import('./db');

let conn: ConnModule;
let authm: AuthModule;
let pub: PublishModule;
let dbm: DbModule;

const origFetch = globalThis.fetch;
let seenRequests: { url: string; init: RequestInit }[] = [];
let tokenResponder: ((url: string, init: RequestInit) => Response) | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

let aliceId = 0;
let bobId = 0;

function clearConnections(): void {
  dbm.getDb().prepare('DELETE FROM x_connections').run();
}

function snapshot(userId: number): { access: string | null; refresh: string | null; updated: string | null } {
  const row = conn.getXConnectionByUserId(userId);
  return { access: row?.access_token ?? null, refresh: row?.refresh_token ?? null, updated: row?.updated_at ?? null };
}

function connectAliceRow(): void {
  conn.upsertXConnection(aliceId, {
    xUserId: 'xuid-alice',
    username: 'alice_x',
    accessToken: 'oauth-token-alice',
    refreshToken: 'rt-alice',
    expiresIn: 7200,
  });
}

function publishAs(userId: number) {
  return pub.maybePublishToX({
    contentId: null,
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'ready',
    text: 'hello',
    userId,
  });
}

before(async () => {
  conn = await import('./x-connections');
  authm = await import('./auth');
  pub = await import('./publish-to-x');
  dbm = await import('./db');

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seenRequests.push({ url, init: init ?? {} });
    if (!tokenResponder) throw new Error(`unexpected fetch (no responder): ${url}`);
    return tokenResponder(url, init ?? {});
  }) as typeof fetch;

  authm.ensureAuthTables();
  const db = dbm.getDb();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username IN ('iso_alice', 'iso_bob');");
  aliceId = authm.createUser('iso_alice', 'editor-password-123', 'editor').id;
  bobId = authm.createUser('iso_bob', 'editor-password-123', 'editor').id;
});

after(() => {
  globalThis.fetch = origFetch;
  return Promise.resolve()
    .then(() => dbm.resetDbForTests())
    .then(() => rmSync(tempDir, { recursive: true, force: true }));
});

function resetMocks() {
  seenRequests = [];
  tokenResponder = null;
  delete process.env.X_ACCESS_TOKEN;
}

// ─── TEST 1: B with no connection cannot post as A ───

test('TEST 1: unconnected user cannot publish via another user\'s X connection', async () => {
  clearConnections();
  resetMocks();
  connectAliceRow();
  const before = snapshot(aliceId);

  const res = await publishAs(bobId);

  if (res.attempted && !res.ok) {
    assert.equal(res.status, 412);
    assert.match(res.error, /Connect X/);
  } else {
    assert.fail('expected a 412 integration error for the unconnected user');
  }
  // No tweet posted and no token endpoint touched (no use AND no refresh of A's token).
  assert.ok(!seenRequests.some((r) => r.url.includes('/2/tweets')), 'must not call POST /2/tweets');
  assert.ok(!seenRequests.some((r) => r.url.includes('/oauth2/token')), 'must not touch the token endpoint');
  // A's connection is byte-identical: not used, not refreshed, not deleted.
  assert.deepEqual(snapshot(aliceId), before);
  assert.ok(conn.getXConnectionByUserId(aliceId), "A's connection must survive B's attempt");
});

// ─── TEST 2: A publishes with A's token ───

test("TEST 2: connected user publishes with their own token", async () => {
  clearConnections();
  resetMocks();
  connectAliceRow();
  tokenResponder = (url, init) => {
    assert.ok(url.includes('/2/tweets'));
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer oauth-token-alice');
    return jsonResponse({ data: { id: 'tweet-a', text: 'hello' } });
  };

  const res = await publishAs(aliceId);

  assert.deepEqual(res, {
    attempted: true,
    ok: true,
    tweetId: 'tweet-a',
    duplicate: false,
    xUserId: 'xuid-alice',
    xUsername: 'alice_x',
  });
});

// ─── TEST 3: both connected — B uses ONLY B's token ───

test("TEST 3: with both connected, each user posts only as themselves", async () => {
  clearConnections();
  resetMocks();
  connectAliceRow();
  conn.upsertXConnection(bobId, {
    xUserId: 'xuid-bob',
    username: 'bob_x',
    accessToken: 'oauth-token-bob',
    refreshToken: 'rt-bob',
    expiresIn: 7200,
  });
  const aliceBefore = snapshot(aliceId);
  tokenResponder = (url, init) => {
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer oauth-token-bob');
    return jsonResponse({ data: { id: 'tweet-b', text: 'hello' } });
  };

  const res = await publishAs(bobId);

  if (res.attempted && res.ok) {
    assert.equal(res.xUserId, 'xuid-bob');
    assert.equal(res.xUsername, 'bob_x');
  } else {
    assert.fail('expected B to post successfully as themselves');
  }
  assert.deepEqual(snapshot(aliceId), aliceBefore);
});

// ─── TEST 4: legacy shared env sender ───

test('TEST 4: no OAuth connections + X_ACCESS_TOKEN posts via the shared sender', async () => {
  clearConnections();
  resetMocks();
  process.env.X_ACCESS_TOKEN = 'shared-admin-token';
  tokenResponder = (url, init) => {
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer shared-admin-token');
    return jsonResponse({ data: { id: 'tweet-env', text: 'hello' } });
  };

  const res = await publishAs(bobId);

  assert.deepEqual(res, {
    attempted: true,
    ok: true,
    tweetId: 'tweet-env',
    duplicate: false,
    xUserId: null,
    xUsername: null,
  });
});

// ─── TEST 5: only the owner's expired token refreshes ───

test("TEST 5: expired token refresh touches only the publisher's connection", async () => {
  clearConnections();
  resetMocks();
  connectAliceRow(); // fresh — must stay untouched
  conn.upsertXConnection(bobId, {
    xUserId: 'xuid-bob',
    username: 'bob_x',
    accessToken: 'oauth-token-bob-stale',
    refreshToken: 'rt-bob',
    expiresIn: 7200,
  });
  // Age B's token into expiry without touching A's.
  dbm.getDb().prepare('UPDATE x_connections SET expires_at = ? WHERE user_id = ?').run(
    Math.floor(Date.now() / 1000) - 10, bobId,
  );
  const aliceBefore = snapshot(aliceId);
  tokenResponder = (url, init) => {
    if (url.includes('/oauth2/token')) {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'rt-bob');
      return jsonResponse({ access_token: 'at-bob-new', refresh_token: 'rt-bob-new', expires_in: 7200 });
    }
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer at-bob-new');
    return jsonResponse({ data: { id: 'tweet-b2', text: 'hello' } });
  };

  const res = await publishAs(bobId);

  if (!res.attempted || !res.ok) assert.fail('expected B to post successfully after refresh');
  const bobAfter = conn.getXConnectionByUserId(bobId);
  assert.equal(bobAfter?.access_token, 'at-bob-new');
  assert.equal(bobAfter?.refresh_token, 'rt-bob-new');
  assert.deepEqual(snapshot(aliceId), aliceBefore);
});

// ─── TEST 6: revoked refresh invalidates ONLY the owner's connection ───

test("TEST 6: invalid_grant invalidates only the publisher's connection", async () => {
  clearConnections();
  resetMocks();
  connectAliceRow();
  conn.upsertXConnection(bobId, {
    xUserId: 'xuid-bob',
    username: 'bob_x',
    accessToken: 'oauth-token-bob-stale',
    refreshToken: 'rt-bob-dead',
    expiresIn: 7200,
  });
  dbm.getDb().prepare('UPDATE x_connections SET expires_at = ? WHERE user_id = ?').run(
    Math.floor(Date.now() / 1000) - 10, bobId,
  );
  const aliceBefore = snapshot(aliceId);
  tokenResponder = (url) => {
    if (url.includes('/oauth2/token')) {
      return jsonResponse({ error: 'invalid_grant', error_description: 'revoked' }, 400);
    }
    throw new Error(`must not post after revocation: ${url}`);
  };

  const res = await publishAs(bobId);

  if (res.attempted && !res.ok) {
    assert.equal(res.status, 412);
  } else {
    assert.fail('expected a 412 integration error after revocation');
  }
  assert.equal(conn.getXConnectionByUserId(bobId), null);
  assert.deepEqual(snapshot(aliceId), aliceBefore);
  assert.ok(conn.getXConnectionByUserId(aliceId), "A's connection must survive B's revocation");

  // The silent cleanup must leave an audit trail (identity only, no tokens).
  const audits = dbm.getDb().prepare(
    "SELECT target, detail FROM audit_log WHERE action = 'x.disconnect' ORDER BY id DESC",
  ).all() as { target: string; detail: string }[];
  const entry = audits.find((a) => a.target === 'x:xuid-bob');
  assert.ok(entry, 'expected an x.disconnect audit entry for the cleanup');
  const detail = JSON.parse(entry.detail) as Record<string, unknown>;
  assert.equal(detail.reason, 'invalid_grant_cleanup');
  assert.equal(detail.x_username, 'bob_x');
  const detailJson = entry.detail;
  assert.ok(!detailJson.includes('rt-bob-dead'), 'audit must never contain refresh tokens');
  assert.ok(!detailJson.includes('oauth-token-bob-stale'), 'audit must never contain access tokens');
});

// ─── TEST 7: same X account cannot be taken by a second user ───

test('TEST 7: second user connecting the same X account gets a clear conflict', async () => {
  clearConnections();
  resetMocks();
  conn.upsertXConnection(aliceId, {
    xUserId: 'xuid-shared',
    username: 'shared_x',
    accessToken: 'oauth-token-alice',
    refreshToken: 'rt-alice',
    expiresIn: 7200,
  });
  const aliceBefore = snapshot(aliceId);

  // upsertXConnection throws synchronously (it is not async).
  let err: (Error & { code?: string }) | null = null;
  try {
    conn.upsertXConnection(bobId, {
      xUserId: 'xuid-shared',
      username: 'shared_x',
      accessToken: 'oauth-token-bob',
      expiresIn: 7200,
    });
  } catch (e) {
    err = e as Error & { code?: string };
  }

  assert.ok(err instanceof Error, 'second connect must fail');
  assert.equal(err.code, conn.X_ACCOUNT_TAKEN_CODE);
  assert.match(err.message, /already connected to another/);
  assert.ok(!String(err.message).includes('oauth-token'), 'error must not leak tokens');
  assert.deepEqual(snapshot(aliceId), aliceBefore);
  assert.equal(conn.getXConnectionByUserId(bobId), null);

  // Same-user reconnect (token rotation) still works.
  const renewed = conn.upsertXConnection(aliceId, {
    xUserId: 'xuid-shared',
    username: 'shared_x',
    accessToken: 'oauth-token-alice-v2',
    expiresIn: 7200,
  });
  assert.equal(renewed.access_token, 'oauth-token-alice-v2');
});

// ─── TEST 8: session switch between start and callback fails closed ───

test("TEST 8: OAuth started by A cannot complete as B after a session switch", async () => {
  clearConnections();
  resetMocks();
  const startMod = await import('../app/api/auth/x/start/route');
  const callbackMod = await import('../app/api/auth/x/callback/route');

  const sessionA = authm.createSession(aliceId);
  const sessionB = authm.createSession(bobId);

  const startRes = await startMod.GET(
    new Request('http://localhost/api/auth/x/start?from=/integrations', {
      headers: { cookie: `hermes-session=${sessionA}` },
    }),
  );
  assert.equal(startRes.status, 307);
  const location = startRes.headers.get('location') ?? '';
  assert.ok(location.includes('twitter.com/i/oauth2/authorize'), 'must redirect to X');
  const state = new URL(location).searchParams.get('state');
  assert.ok(state, 'must carry a state param');
  const setCookies = startRes.headers.getSetCookie();
  const stateCookie = setCookies.find((c) => c.startsWith('hermes-x-oauth-state=')) ?? '';
  assert.ok(stateCookie, 'must set the state cookie');
  const stateValue = stateCookie.split(';')[0].split('=').slice(1).join('=');

  // Attacker/victim session switch: B's session presents A's flow cookies.
  let fetchCalled = false;
  tokenResponder = () => {
    fetchCalled = true;
    return jsonResponse({}, 400);
  };
  const callbackRes = await callbackMod.GET(
    new Request(`http://localhost/api/auth/x/callback?code=cb-code-1&state=${state}`, {
      headers: { cookie: `hermes-session=${sessionB}; hermes-x-oauth-state=${stateValue}` },
    }),
  );

  assert.equal(fetchCalled, false, 'must fail before any token exchange');
  assert.equal(callbackRes.status, 307);
  const backTo = callbackRes.headers.get('location') ?? '';
  assert.ok(backTo.includes('x_error='), 'must redirect with an error, not success');
  assert.ok(!backTo.includes('x=connected'), 'must not report success');
  const count = (dbm.getDb().prepare('SELECT COUNT(*) AS c FROM x_connections').get() as { c: number }).c;
  assert.equal(count, 0, 'no connection may be created for either user');
});

// ─── TEST 9: API disconnect audits identity without tokens ───

test('TEST 9: DELETE /api/integrations/x removes the row and audits it', async () => {
  clearConnections();
  resetMocks();
  conn.upsertXConnection(aliceId, {
    xUserId: 'xuid-alice',
    username: 'alice_x',
    accessToken: 'oauth-token-alice',
    refreshToken: 'rt-alice',
    expiresIn: 7200,
  });
  const delMod = await import('../app/api/integrations/x/route');
  const sess = authm.createSession(aliceId);
  const res = await delMod.DELETE(
    new Request('http://localhost/api/integrations/x', {
      method: 'DELETE',
      headers: { cookie: `hermes-session=${sess}` },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(conn.getXConnectionByUserId(aliceId), null);

  const audits = dbm.getDb().prepare(
    "SELECT target, detail FROM audit_log WHERE action = 'x.disconnect' ORDER BY id DESC",
  ).all() as { target: string; detail: string }[];
  const entry = audits.find((a) => a.target === 'x:xuid-alice');
  assert.ok(entry, 'expected an x.disconnect audit entry for the manual disconnect');
  const detail = JSON.parse(entry.detail) as Record<string, unknown>;
  assert.equal(detail.reason, 'user_disconnect');
  const detailJson = entry.detail;
  assert.ok(!detailJson.includes('oauth-token-alice'), 'audit must never contain access tokens');
  assert.ok(!detailJson.includes('rt-alice'), 'audit must never contain refresh tokens');
});
