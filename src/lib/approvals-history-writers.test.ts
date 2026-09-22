import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #85: the approvals page approves via
 * PATCH /api/content and PATCH /api/sequences, but only
 * /api/automations/approve wrote activity_log ('approve'/'reject' rows) —
 * so page approvals never appeared in the page's own history panel.
 * Both PATCH routes must now record the transition.
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-approvals-hist-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
delete process.env.X_ACCESS_TOKEN;

let dbm: typeof import('./db');
let contentPatch: typeof import('../app/api/content/route')['PATCH'];
let sequencesPatch: typeof import('../app/api/sequences/route')['PATCH'];
let db: ReturnType<typeof import('./db')['getDb']>;

const API = { 'content-type': 'application/json', 'x-api-key': 'test-api-key' };

before(async () => {
  dbm = await import('./db');
  contentPatch = (await import('../app/api/content/route')).PATCH;
  sequencesPatch = (await import('../app/api/sequences/route')).PATCH;
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function patch(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'PATCH', headers: API, body: JSON.stringify(body) });
}

function approveRows(): { action: string; detail: string }[] {
  return db.prepare(
    `SELECT action, detail FROM activity_log WHERE action IN ('approve','reject') ORDER BY id`
  ).all() as { action: string; detail: string }[];
}

test('PATCH /api/content to ready writes an approve row into activity_log (#85)', async () => {
  db.prepare(
    `INSERT INTO content_posts (id, platform, format, status) VALUES ('cp-hist-1', 'linkedin', 'post', 'pending_approval')`
  ).run();

  const res = await contentPatch(patch('http://localhost/api/content', { id: 'cp-hist-1', status: 'ready' }));
  assert.equal(res.status, 200);

  const rows = approveRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'approve');
  assert.match(rows[0].detail, /cp-hist-1/);
});

test('PATCH /api/content to rejected writes a reject row', async () => {
  db.prepare(
    `INSERT INTO content_posts (id, platform, format, status) VALUES ('cp-hist-2', 'linkedin', 'post', 'pending_approval')`
  ).run();

  const res = await contentPatch(patch('http://localhost/api/content', { id: 'cp-hist-2', status: 'rejected' }));
  assert.equal(res.status, 200);

  const rows = approveRows();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].action, 'reject');
  assert.match(rows[1].detail, /cp-hist-2/);
});

test('non-approval status transitions do not write activity_log rows', async () => {
  db.prepare(
    `INSERT INTO content_posts (id, platform, format, status) VALUES ('cp-hist-3', 'linkedin', 'post', 'draft')`
  ).run();

  const res = await contentPatch(patch('http://localhost/api/content', { id: 'cp-hist-3', status: 'pending_approval' }));
  assert.equal(res.status, 200);
  assert.equal(approveRows().length, 2); // unchanged
});

test('PATCH /api/sequences to approved writes an approve row (#85)', async () => {
  db.prepare(`INSERT INTO leads (id, first_name, status) VALUES ('lead-hist-1', 'Test', 'approved')`).run();
  db.prepare(
    `INSERT INTO sequences (id, lead_id, sequence_name, status) VALUES ('seq-hist-1', 'lead-hist-1', 'intro', 'pending_approval')`
  ).run();

  const res = await sequencesPatch(patch('http://localhost/api/sequences', { id: 'seq-hist-1', status: 'approved' }));
  assert.equal(res.status, 200);

  const rows = approveRows();
  const last = rows[rows.length - 1];
  assert.equal(last.action, 'approve');
  assert.match(last.detail, /seq-hist-1/);
});

test('PATCH /api/sequences to cancelled writes a reject row', async () => {
  const res = await sequencesPatch(patch('http://localhost/api/sequences', { id: 'seq-hist-1', status: 'cancelled' }));
  assert.equal(res.status, 200);

  const rows = approveRows();
  const last = rows[rows.length - 1];
  assert.equal(last.action, 'reject');
  assert.match(last.detail, /seq-hist-1/);
});
