import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #177: GET /api/memory-alerts answered 404
 * forever when no report file existed, and the Memory page polls it every
 * minute — permanent network/console spam. A missing report is now a 200
 * degraded payload (like the sibling memory routes) with configured:false,
 * which the page renders as an actionable empty state.
 *
 * HERMES_OPENCLAW_INSTANCES points a throwaway instance at the temp dir,
 * so both the missing- and present-file paths are fully hermetic.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-mem-alerts-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const openclawHome = path.join(tempDir, 'openclaw-home');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.HERMES_OPENCLAW_INSTANCES = JSON.stringify([
  { id: 'test-mem', label: 'Test', openclawHome },
]);
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type RouteModule = typeof import('../app/api/memory-alerts/route');
let dbm: DbModule;
let authm: AuthModule;
let alertsGet: RouteModule['GET'];
let adminCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function get(instance: string): Promise<Response> {
  return alertsGet(
    new Request(`http://localhost/api/memory-alerts?instance=${instance}`, {
      headers: { cookie: adminCookie },
    }),
  );
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  alertsGet = (await imp<RouteModule>('../app/api/memory-alerts/route')).GET;
  const db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const admin = authm.createUser('mem_admin', 'mem-admin-pass-99', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('missing report degrades to 200 with configured:false instead of 404 (#177)', async () => {
  const res = await get('test-mem');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    active: unknown[];
    new: unknown[];
    thresholds: Record<string, number>;
    configured?: boolean;
    error?: string;
  };
  assert.deepEqual(body.active, []);
  assert.deepEqual(body.new, []);
  assert.equal(body.configured, false);
  assert.equal(body.error, undefined, 'no error key on the degraded payload');
});

test('present report is still returned verbatim (#177)', async () => {
  const report = {
    active: [{ key: 'a1', type: 'drift', severity: 'high', title: 'Drift!', message: 'drift happened' }],
    new: [],
    thresholds: { contradictions: 2, duplicates: 3, weak_agents: 1, never_ratio: 0.5 },
  };
  mkdirSync(path.join(openclawHome, 'health'), { recursive: true });
  writeFileSync(path.join(openclawHome, 'health', 'memory-alerts.json'), JSON.stringify(report));

  const res = await get('test-mem');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), report);
});

test('unauthenticated callers still get 401 (#177)', async () => {
  const res = await alertsGet(new Request('http://localhost/api/memory-alerts?instance=test-mem'));
  assert.equal(res.status, 401);
});
