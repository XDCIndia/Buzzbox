import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #69: the header used to display wall-clock time
 * as a fake "last sync". syncAll() must instead record REAL synchronization
 * health (success and failure) and /api/settings must expose it so the UI can
 * show "synced Xs ago", "sync failed", or "not yet synchronized".
 *
 * Dynamic imports AFTER env setup (ESM hoisting pollutes the live dev DB
 * otherwise — see the note in routes-api.test.ts). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-sync-health-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

let dbm: typeof import('./db');
let sync: typeof import('./sync');
let settingsGet: typeof import('../app/api/settings/route')['GET'];

before(async () => {
  dbm = await import('./db');
  sync = await import('./sync');
  const route = await import('../app/api/settings/route');
  settingsGet = route.GET;
  dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function writeQueue(items: unknown[]) {
  writeFileSync(path.join(tempDir, 'content-queue.json'), JSON.stringify(items));
}

test('before any sync runs, health reports not-yet-synchronized (no fake timestamps)', () => {
  const health = sync.getSyncHealth();
  assert.equal(health.last_sync_at, null);
  assert.equal(health.last_sync_status, null);
});

test('a successful syncAll records ok status, timestamp, duration, and last success', () => {
  writeQueue([{ id: 'sq-1', platform: 'x', text: 'hello' }]);
  sync.syncAll();
  const health = sync.getSyncHealth();
  assert.equal(health.last_sync_status, 'ok');
  assert.equal(health.last_sync_error, null);
  assert.ok(health.last_sync_at, 'last_sync_at must be set');
  assert.ok(!Number.isNaN(Date.parse(health.last_sync_at as string)), 'timestamp must be ISO');
  assert.ok(typeof health.last_sync_duration_ms === 'number');
  assert.equal(health.last_success_at, health.last_sync_at);
});

test('a failing syncAll records error status and preserves the previous last success', () => {
  // scheduled_for is bound into SQLite; a non-primitive makes the insert
  // throw inside the transaction, surfacing as a syncAll failure.
  writeQueue([{ id: 'sq-bad', scheduled_for: { not: 'a date' } }]);
  const beforeHealth = sync.getSyncHealth();
  sync.syncAll();
  const health = sync.getSyncHealth();
  assert.equal(health.last_sync_status, 'error');
  assert.ok(health.last_sync_error && health.last_sync_error.length > 0);
  assert.ok(health.last_sync_at, 'failed attempts still get a timestamp');
  assert.equal(health.last_success_at, beforeHealth.last_success_at, 'last success must survive a failure');
});

test('GET /api/settings exposes the recorded sync_health', async () => {
  const res = await settingsGet(
    new NextRequest('http://localhost/api/settings', {
      headers: { 'x-api-key': 'test-api-key' },
    }) as unknown as Request,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.sync_health, 'sync_health must be present in the settings payload');
  assert.equal(body.sync_health.last_sync_status, 'error');
  assert.ok(body.sync_health.last_sync_at);
  assert.equal(body.sync_health.last_success_at, sync.getSyncHealth().last_success_at);
});
