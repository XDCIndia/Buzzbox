import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* GET /api/analytics X provider: when the app-level bearer token is missing
 * but the viewer has a linked X OAuth account, the response must carry
 * oauthConnected/oauthUsername (read-only row lookup — no token refresh,
 * no network) so the UI can distinguish "account linked" from "nothing
 * connected" (#206). Dynamic imports AFTER env setup (isolated temp DB). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-analytics-x-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
for (const k of [
  'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'X_USERNAME', 'X_ACCESS_TOKEN',
  'GA4_PROPERTY_ID', 'GA4_PROPERTY', 'GA4_SERVICE_ACCOUNT_JSON', 'GA4_SERVICE_ACCOUNT_JSON_B64',
  'PLAUSIBLE_SITE_ID', 'PLAUSIBLE_API_KEY',
]) delete process.env[k];

type AuthModule = typeof import('./auth');
type ConnModule = typeof import('./x-connections');
type DbModule = typeof import('./db');
let authm: AuthModule;
let conn: ConnModule;
let dbm: DbModule;
let analyticsGet: typeof import('../app/api/analytics/route')['GET'];

const origFetch = globalThis.fetch;
let userId = 0;
let sessionCookie = '';

async function getX(): Promise<{ configured?: boolean; oauthConnected?: boolean; oauthUsername?: string }> {
  const res = await analyticsGet(
    new NextRequest('http://localhost/api/analytics?days=7', { headers: { cookie: sessionCookie } }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { x: { configured?: boolean; oauthConnected?: boolean; oauthUsername?: string } };
  return body.x;
}

before(async () => {
  authm = await import('./auth');
  conn = await import('./x-connections');
  analyticsGet = (await import('../app/api/analytics/route')).GET;

  authm.ensureAuthTables();
  dbm = await import('./db');
  const db = dbm.getDb();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'analytics_x_viewer';");
  userId = authm.createUser('analytics_x_viewer', 'viewer-password-123', 'viewer').id;
  sessionCookie = `hermes-session=${authm.createSession(userId)}`;

  // Any network access fails the test: the flag path must be DB-only.
  globalThis.fetch = (() => {
    throw new Error('no network allowed while resolving the oauth flag');
  }) as unknown as typeof fetch;
});

after(() => {
  globalThis.fetch = origFetch;
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('no linked account: no oauth flag, provider unconfigured', async () => {
  const x = await getX();
  assert.equal(x.configured, false);
  assert.ok(!x.oauthConnected);
});

test('linked account: oauth flag carries the username with zero side effects', async () => {
  conn.upsertXConnection(userId, {
    xUserId: 'xuid-viewer',
    username: 'viewer_x',
    accessToken: 'oauth-token-viewer',
    refreshToken: 'rt-viewer',
    expiresIn: 7200,
  });
  const x = await getX();
  assert.equal(x.configured, false);
  assert.equal(x.oauthConnected, true);
  assert.equal(x.oauthUsername, 'viewer_x');
});
