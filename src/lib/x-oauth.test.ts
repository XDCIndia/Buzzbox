import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* X OAuth 2.0 (PKCE) integration tests — no real X credentials, fetch is mocked.
 *
 * Covers: start/oauth helpers (state + PKCE generation), callback state
 * validation, token exchange (success + failure), successful connection
 * persistence, failed authorization handling, token refresh (expiry +
 * revoked), disconnected accounts, and posting with the connected account
 * (with legacy X_ACCESS_TOKEN fallback preserved).
 *
 * DB-touching modules capture HERMES_DB_PATH at import time, so env is set
 * first and modules are dynamically imported (same pattern as
 * publish-claim.test.ts). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-x-oauth-test-'));
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

type OAuthModule = typeof import('./x-oauth');
type ConnModule = typeof import('./x-connections');
type AuthModule = typeof import('./auth');
type PublishModule = typeof import('./publish-to-x');

let oauth: OAuthModule;
let conn: ConnModule;
let authm: AuthModule;
let pub: PublishModule;

const origFetch = globalThis.fetch;

/** Queued mock responses by URL substring match. */
let tokenResponder: ((url: string, init: RequestInit) => Response) | null = null;
let seenRequests: { url: string; init: RequestInit }[] = [];

function mockFetch(url: string, init: RequestInit): Response {
  if (!tokenResponder) throw new Error(`unexpected fetch (no responder): ${url}`);
  return tokenResponder(url, init);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

let userId: number;

before(async () => {
  oauth = await import('./x-oauth');
  conn = await import('./x-connections');
  authm = await import('./auth');
  pub = await import('./publish-to-x');

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seenRequests.push({ url, init: init ?? {} });
    return mockFetch(url, init ?? {});
  }) as typeof fetch;

  authm.ensureAuthTables();
  const db = (await import('./db')).getDb();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'xoauth_editor';");
  const editor = authm.createUser('xoauth_editor', 'editor-password-123', 'editor');
  userId = editor.id;
});

after(() => {
  globalThis.fetch = origFetch;
  // Close the SQLite handle first: on Windows an open (WAL) DB file cannot
  // be unlinked (EBUSY) — same pattern as publish-claim.test.ts.
  return import('./db').then((dbm) => {
    dbm.resetDbForTests();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

function resetMocks() {
  seenRequests = [];
  tokenResponder = null;
}

// ─── 1-3: start endpoint helpers — state + PKCE generation ───

test('state generation produces unique opaque tokens', () => {
  const a = oauth.generateState();
  const b = oauth.generateState();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});

test('PKCE generation: 43-char verifier, S256 challenge verifies', () => {
  const verifier = oauth.generateCodeVerifier();
  assert.equal(verifier.length, 43);
  assert.match(verifier, /^[A-Za-z0-9\-_]+$/);
  const challenge = oauth.generateCodeChallenge(verifier);
  assert.equal(challenge.length, 43);
  // Independent recomputation matches (real S256, not a stub).
  const expected = oauth.base64UrlEncode(createHash('sha256').update(verifier, 'utf8').digest());
  assert.equal(challenge, expected);
  assert.notEqual(oauth.generateCodeChallenge(oauth.generateCodeVerifier()), challenge);
});

test('authorize URL carries PKCE + state + minimum scopes, no DM scopes', () => {
  const url = new URL(
    oauth.buildXAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://tunnel.example.test/api/auth/x/callback',
      state: 's123',
      codeChallenge: 'c123',
    }),
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 's123');
  const scope = url.searchParams.get('scope') ?? '';
  for (const s of ['tweet.read', 'tweet.write', 'users.read', 'offline.access']) {
    assert.ok(scope.split(' ').includes(s), `scope missing: ${s}`);
  }
  assert.ok(!/dm\./i.test(scope) && !/direct_message/i.test(scope), 'must not request DM permissions');
});

// ─── 4: callback state validation ───

test('state cookie round-trips with bound user; tampered/legacy values rejected', () => {
  const raw = oauth.serializeXStateCookie({ state: 'abc', codeVerifier: 'verifier-1', userId: 7, from: '/integrations' });
  assert.deepEqual(oauth.parseXStateCookie(raw), { state: 'abc', codeVerifier: 'verifier-1', userId: 7, from: '/integrations' });
  assert.equal(oauth.parseXStateCookie(null), null);
  assert.equal(oauth.parseXStateCookie('garbage'), null);
  assert.equal(oauth.parseXStateCookie('a:b'), null);
  assert.equal(oauth.parseXStateCookie('a:b:c'), null); // pre-binding 3-part cookies fail closed
  assert.equal(oauth.parseXStateCookie('abc:verifier-1:notanid:/x'), null);
  assert.ok(oauth.statesMatch('abc', 'abc'));
  assert.ok(!oauth.statesMatch('abc', 'abd'));
  assert.ok(!oauth.statesMatch('abc', 'abcd'));
  assert.ok(!oauth.statesMatch('', ''));
});

// ─── 5-6: token exchange ───

test('token exchange posts PKCE verifier + Basic auth, returns tokens', async () => {
  resetMocks();
  tokenResponder = (url, init) => {
    assert.ok(url.includes('/oauth2/token'));
    const headers = init.headers as Record<string, string>;
    assert.match(headers.Authorization, /^Basic /);
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'auth-code-1');
    assert.equal(body.get('code_verifier'), 'verifier-1');
    return jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7200, scope: 'tweet.read tweet.write users.read offline.access', token_type: 'bearer' });
  };
  const tokens = await oauth.exchangeXAuthCode({ code: 'auth-code-1', codeVerifier: 'verifier-1' });
  assert.equal(tokens.access_token, 'at-1');
  assert.equal(tokens.refresh_token, 'rt-1');
});

test('token exchange failure throws generic error without leaking secrets', async () => {
  resetMocks();
  tokenResponder = () => jsonResponse({ error: 'invalid_grant', error_description: 'bad code boom' }, 400);
  const err = await oauth.exchangeXAuthCode({ code: 'bad', codeVerifier: 'v' }).then(
    () => null,
    (e: Error) => e,
  );
  assert.ok(err instanceof Error);
  assert.equal((err as Error & { code?: string }).code, 'invalid_grant');
  assert.ok(!err.message.includes('test-client-secret'), 'error must not leak the client secret');
});

// ─── userinfo + successful connection ───

test('successful connection persists the X account without exposing tokens', async () => {
  resetMocks();
  tokenResponder = (url) => {
    if (url.includes('/oauth2/token')) {
      return jsonResponse({ access_token: 'at-conn', refresh_token: 'rt-conn', expires_in: 7200, scope: 'x', token_type: 'bearer' });
    }
    return jsonResponse({ data: { id: 'xuid-1', username: 'buzzbox_test', name: 'Buzzbox' } });
  };
  const tokens = await oauth.exchangeXAuthCode({ code: 'c', codeVerifier: 'v' });
  const xUser = await oauth.fetchXOAuthUser(tokens.access_token);
  const row = conn.upsertXConnection(userId, {
    xUserId: xUser.id,
    username: xUser.username,
    name: xUser.name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope,
    expiresIn: tokens.expires_in,
  });
  assert.equal(row.x_username, 'buzzbox_test');
  const status = conn.toPublicStatus(conn.getXConnectionByUserId(userId));
  assert.equal(status.connected, true);
  assert.equal(status.username, 'buzzbox_test');
  assert.ok(!JSON.stringify(status).includes('at-conn'), 'status must never contain tokens');
  assert.ok(!JSON.stringify(status).includes('rt-conn'), 'status must never contain refresh tokens');
});

// ─── 8: token refresh ───

test('expired access token refreshes and persists the rotation', async () => {
  // Force expiry in the past; X rotates the refresh token on use.
  const { getDb } = await import('./db');
  getDb().prepare('UPDATE x_connections SET expires_at = ?, refresh_token = ? WHERE user_id = ?').run(
    Math.floor(Date.now() / 1000) - 10, 'rt-old', userId,
  );
  resetMocks();
  tokenResponder = (url, init) => {
    assert.ok(url.includes('/oauth2/token'));
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'rt-old');
    return jsonResponse({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 });
  };
  const cred = await conn.getValidXAccessTokenForUser(userId);
  assert.equal(cred?.accessToken, 'at-new');
  const stored = conn.getXConnectionByUserId(userId);
  assert.equal(stored?.access_token, 'at-new');
  assert.equal(stored?.refresh_token, 'rt-new');
});

test('revoked refresh token drops the connection (reconnect required)', async () => {
  const { getDb } = await import('./db');
  getDb().prepare('UPDATE x_connections SET expires_at = ?, refresh_token = ? WHERE user_id = ?').run(
    Math.floor(Date.now() / 1000) - 10, 'rt-dead', userId,
  );
  resetMocks();
  tokenResponder = () => jsonResponse({ error: 'invalid_grant', error_description: 'revoked' }, 400);
  const cred = await conn.getValidXAccessTokenForUser(userId);
  assert.equal(cred, null);
  assert.equal(conn.getXConnectionByUserId(userId), null);
});

// ─── 9: disconnected account ───

test('disconnected account resolves to null; posting asks to connect', async () => {
  resetMocks();
  delete process.env.X_ACCESS_TOKEN;
  conn.deleteXConnectionByUserId(userId);
  assert.equal(await conn.getValidXAccessTokenForUser(userId), null);
  const res = await pub.maybePublishToX({
    contentId: null,
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'ready',
    text: 'hello',
    userId,
  });
  assert.equal(res.attempted, true);
  assert.equal(res.ok, false);
  if (res.ok === false) {
    assert.equal(res.status, 412);
    assert.match(res.error, /Connect X|Integrations/i);
  }
});

// ─── 10: posting using the connected X account ───

test('posting uses the connected OAuth token, not the shared env token', async () => {
  conn.upsertXConnection(userId, {
    xUserId: 'xuid-1',
    username: 'buzzbox_test',
    accessToken: 'oauth-token-123',
    refreshToken: 'rt-1',
    expiresIn: 7200,
  });
  process.env.X_ACCESS_TOKEN = 'env-token-should-not-win';
  resetMocks();
  tokenResponder = (url, init) => {
    assert.ok(url.includes('/2/tweets'));
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer oauth-token-123');
    return jsonResponse({ data: { id: 'tweet-1', text: 'hello' } });
  };
  const res = await pub.maybePublishToX({
    contentId: null,
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'ready',
    text: 'hello',
    userId,
  });
  assert.deepEqual(res, { attempted: true, ok: true, tweetId: 'tweet-1', duplicate: false, xUserId: 'xuid-1', xUsername: 'buzzbox_test' });
  delete process.env.X_ACCESS_TOKEN;
});

test('legacy X_ACCESS_TOKEN still posts when no account is connected', async () => {
  conn.deleteXConnectionByUserId(userId);
  process.env.X_ACCESS_TOKEN = 'legacy-manual-token';
  resetMocks();
  tokenResponder = (url, init) => {
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer legacy-manual-token');
    return jsonResponse({ data: { id: 'tweet-legacy', text: 'hi' } });
  };
  const res = await pub.maybePublishToX({
    contentId: null,
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'ready',
    text: 'hi',
    userId,
  });
  assert.deepEqual(res, { attempted: true, ok: true, tweetId: 'tweet-legacy', duplicate: false, xUserId: null, xUsername: null });
  delete process.env.X_ACCESS_TOKEN;
});
