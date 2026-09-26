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

function clearStateFile(name: string) {
  rmSync(path.join(tempDir, name), { force: true });
}

function activityCount(): number {
  return (dbm.getDb().prepare('SELECT COUNT(*) c FROM activity_log').get() as { c: number }).c;
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

test('a failing source does not starve later sources, and health names it (#119)', () => {
  writeQueue([{ id: 'sq-bad2', scheduled_for: { not: 'a date' } }]);
  writeFileSync(path.join(tempDir, 'leads.json'), JSON.stringify([{ id: 'iso-lead', first_name: 'Iso' }]));
  sync.syncAll();

  const health = sync.getSyncHealth();
  assert.equal(health.last_sync_status, 'error');
  assert.match(String(health.last_sync_error), /content-queue/);

  const byName = new Map(health.sources.map(s => [s.name, s]));
  assert.equal(byName.get('content-queue')?.status, 'error');
  assert.equal(byName.get('leads')?.status, 'ok');

  // The leads source ran despite the content-queue failure.
  const lead = dbm.getDb().prepare(`SELECT first_name FROM leads WHERE id = 'iso-lead'`).get() as { first_name: string };
  assert.equal(lead.first_name, 'Iso');

  clearStateFile('leads.json');
  writeQueue([]);
});

test('corrupt state files surface as source errors instead of silent skips (#119)', () => {
  writeFileSync(path.join(tempDir, 'content-queue.json'), '{"jobs": [broken');
  sync.syncAll();

  const health = sync.getSyncHealth();
  assert.equal(health.last_sync_status, 'error');
  const source = health.sources.find(s => s.name === 'content-queue');
  assert.equal(source?.status, 'error');
  assert.match(String(source?.error), /content-queue\.json/);

  writeQueue([]);
});

test('successful syncAll records a per-source breakdown (#119)', () => {
  writeQueue([{ id: 'sq-ok', platform: 'x', text: 'hi' }]);
  sync.syncAll();

  const health = sync.getSyncHealth();
  assert.equal(health.last_sync_status, 'ok');
  assert.equal(health.sources.length, 14);
  assert.ok(health.sources.every(s => s.status === 'ok' && s.error === null && typeof s.duration_ms === 'number'));
});

test('activity offset persists across restarts without duplicating rows (#119)', () => {
  const fp = path.join(tempDir, 'activity-log.jsonl');
  const line = (action: string) => JSON.stringify({ ts: '2026-09-26 00:00:00', action, detail: 'd', result: 'ok' });
  writeFileSync(fp, [line('a1'), line('a2')].join('\n') + '\n');
  sync.syncAll();
  assert.equal(activityCount(), 2);

  // Simulate a process restart: fresh connection, same state dir.
  writeFileSync(fp, [line('a1'), line('a2'), line('a3')].join('\n') + '\n');
  dbm.resetDbForTests();
  dbm.getDb();
  sync.syncAll();
  assert.equal(activityCount(), 3, 'restart must resume from the persisted offset, not re-insert');

  // Truncation/rotation restarts from zero instead of stalling.
  writeFileSync(fp, [line('b1')].join('\n') + '\n');
  sync.syncAll();
  assert.equal(activityCount(), 4);

  clearStateFile('activity-log.jsonl');
  clearStateFile('activity-log.offset.json');
});
