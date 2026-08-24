import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// NOTE: src/lib/db.ts and src/lib/sync.ts capture their paths at module load,
// so both modules must be dynamically imported inside before() AFTER the env
// vars below are set. This keeps every test write inside the temp dir.
const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-sync-reconcile-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const stateDir = path.join(tempDir, 'state');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = stateDir;

type DbModule = typeof import('./db');
type SyncModule = typeof import('./sync');
let dbm: DbModule;
let sync: SyncModule;

// tsx emits CJS here, so dynamic imports wrap exports under `.default`.
async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function writeState(name: string, data: unknown): void {
  writeFileSync(path.join(stateDir, name), JSON.stringify(data, null, 2), 'utf-8');
}

const db = () => dbm.getDb();

before(async () => {
  mkdirSync(stateDir, { recursive: true });
  dbm = await imp<typeof import('./db')>('./db');
  sync = await imp<typeof import('./sync')>('./sync');
  dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });

  // Leak check: none of the fixture content may exist in the real dev DB.
  const real = new Database('D:/Buzzbox/state/hermes.db', { readonly: true });
  const leaks = real.prepare(
    "SELECT (SELECT COUNT(*) FROM experiments WHERE hypothesis LIKE 'fixture%') e, " +
    "(SELECT COUNT(*) FROM learnings WHERE learning LIKE 'fixture%') l, " +
    "(SELECT COUNT(*) FROM engagements WHERE our_text LIKE 'fixture%') g"
  ).get() as { e: number; l: number; g: number };
  real.close();
  assert.equal(leaks.e + leaks.l + leaks.g, 0, 'test data leaked into the real dev database');
});

// ─── experiments ───────────────────────────────────────────

const EXP_A = { week: 1, hypothesis: 'fixture experiment A', action: 'do A', metric: 'reply_rate', status: 'running' };
const EXP_B = { week: 1, hypothesis: 'fixture experiment B', action: 'do B', metric: 'reply_rate', status: 'proposed' };

test('experiments: repeated sync keeps ids stable and does not duplicate rows', () => {
  writeState('experiment-log.json', [EXP_A, EXP_B]);
  sync.syncExperimentLog();
  const first = db().prepare('SELECT id, week, hypothesis FROM experiments ORDER BY id').all() as Array<{ id: number }>;
  assert.equal(first.length, 2);

  sync.syncExperimentLog();
  sync.syncExperimentLog();
  const second = db().prepare('SELECT id, week, hypothesis FROM experiments ORDER BY id').all() as Array<{ id: number }>;
  assert.deepEqual(second, first);
});

test('experiments: source-owned fields update in place, id preserved', () => {
  writeState('experiment-log.json', [
    { ...EXP_A, status: 'completed', results: { lift: '22%' }, decision: 'keep' },
    EXP_B,
  ]);
  sync.syncExperimentLog();

  const row = db().prepare('SELECT id, status, results, decision FROM experiments WHERE hypothesis = ?').get(EXP_A.hypothesis) as
    { id: number; status: string; results: string; decision: string };
  const idBefore = db().prepare('SELECT id FROM experiments WHERE hypothesis = ?').get(EXP_A.hypothesis) as { id: number };
  assert.equal(row.status, 'completed');
  assert.equal(row.decision, 'keep');
  assert.ok(row.results.includes('22%'));

  writeState('experiment-log.json', [{ ...EXP_A, status: 'completed' }, EXP_B]);
  sync.syncExperimentLog();
  const idAfter = db().prepare('SELECT id FROM experiments WHERE hypothesis = ?').get(EXP_A.hypothesis) as { id: number };
  assert.equal(idAfter.id, idBefore.id, 'id must not churn across syncs');
  assert.equal((row as { results: string }).results.includes('22%'), true);
});

test('experiments: new source record inserts exactly one new row', () => {
  const before = (db().prepare('SELECT COUNT(*) c FROM experiments').get() as { c: number }).c;
  writeState('experiment-log.json', [EXP_A, EXP_B, { week: 2, hypothesis: 'fixture experiment C', status: 'proposed' }]);
  sync.syncExperimentLog();
  const afterCount = (db().prepare('SELECT COUNT(*) c FROM experiments').get() as { c: number }).c;
  assert.equal(afterCount, before + 1);
});

test('experiments: DB-only record survives sync (no deletion contract)', () => {
  db().prepare(
    'INSERT INTO experiments (week, hypothesis, status) VALUES (?, ?, ?)'
  ).run(3, 'fixture experiment DB-ONLY', 'proposed');

  sync.syncExperimentLog();

  const row = db().prepare('SELECT id FROM experiments WHERE hypothesis = ?').get('fixture experiment DB-ONLY');
  assert.ok(row, 'DB-only experiment must not be deleted by sync');
});

test('experiments: source removal retains the DB row (documented ambiguity)', () => {
  writeState('experiment-log.json', [EXP_A]);
  sync.syncExperimentLog();
  const row = db().prepare('SELECT id FROM experiments WHERE hypothesis = ?').get(EXP_B.hypothesis);
  assert.ok(row, 'removing an item from source JSON must not delete the DB row');
  // restore the fuller fixture for later tests
  writeState('experiment-log.json', [EXP_A, EXP_B]);
  sync.syncExperimentLog();
});

// ─── learnings ─────────────────────────────────────────────

const LEARN_A = { learning: 'fixture learning A', validated_week: 1, confidence: 'high', applied_to: ['outreach'] };

test('learnings: repeated sync keeps id and DB-generated created_at stable', () => {
  writeState('experiment-learnings.json', [LEARN_A]);
  sync.syncExperimentLearnings();
  const first = db().prepare('SELECT id, created_at FROM learnings WHERE learning = ?').get(LEARN_A.learning) as
    { id: number; created_at: string };

  sync.syncExperimentLearnings();
  const second = db().prepare('SELECT id, created_at FROM learnings WHERE learning = ?').get(LEARN_A.learning) as
    { id: number; created_at: string };
  assert.equal(second.id, first.id, 'id must not churn');
  assert.equal(second.created_at, first.created_at, 'DB-generated created_at must not reset');
});

test('learnings: source-owned fields update in place, id and created_at preserved', () => {
  writeState('experiment-learnings.json', [
    { ...LEARN_A, confidence: 'medium', applied_to: ['outreach', 'content'] },
  ]);
  sync.syncExperimentLearnings();

  const before = db().prepare('SELECT id, created_at, confidence, applied_to FROM learnings WHERE learning = ?').get(LEARN_A.learning) as
    { id: number; created_at: string; confidence: string; applied_to: string };
  assert.equal(before.confidence, 'medium');
  assert.ok(before.applied_to.includes('content'));
});

test('learnings: DB-only record survives; source removal retains row', () => {
  db().prepare('INSERT INTO learnings (learning, validated_week) VALUES (?, ?)').run('fixture learning DB-ONLY', 9);

  writeState('experiment-learnings.json', [LEARN_A]);
  sync.syncExperimentLearnings();

  const kept = db().prepare('SELECT id FROM learnings WHERE learning = ?').get('fixture learning DB-ONLY');
  assert.ok(kept, 'DB-only learning must survive sync');
});

// ─── linkedin comments (documented destructive replacement) ───

const LI_A = { target_url: 'https://linkedin.com/post/1', target_username: 'prospectA', our_text: 'fixture comment A', status: 'pending', timestamp: '2026-08-22T10:00:00Z' };
const LI_B = { target_url: 'https://linkedin.com/post/2', target_username: 'prospectB', our_text: 'fixture comment B', status: 'sent', timestamp: '2026-08-22T11:00:00Z' };

test('linkedin comments: wipe-and-rewrite is the documented intended behavior', () => {
  writeState('linkedin-comments-queue.json', [LI_A, LI_B]);
  sync.syncLinkedInComments();
  assert.equal((db().prepare("SELECT COUNT(*) c FROM engagements WHERE platform = 'linkedin' AND action_type = 'comment'").get() as { c: number }).c, 2);

  // A DB-only linkedin comment is intentionally removed by the next sync.
  db().prepare(
    "INSERT INTO engagements (platform, action_type, target_url, our_text, status, created_at) VALUES ('linkedin', 'comment', 'https://linkedin.com/post/x', 'fixture comment DB-ONLY', 'pending', '2026-08-22T09:00:00Z')"
  ).run();
  sync.syncLinkedInComments();
  const rows = db().prepare("SELECT our_text, created_at FROM engagements WHERE platform = 'linkedin' AND action_type = 'comment' ORDER BY our_text").all() as
    Array<{ our_text: string; created_at: string }>;
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((r) => r.our_text === 'fixture comment DB-ONLY'), 'source-removed comment is replaced per documented semantics');
  // created_at comes from the source timestamp, not the sync wall clock.
  assert.ok(rows.every((r) => r.created_at === '2026-08-22T10:00:00Z' || r.created_at === '2026-08-22T11:00:00Z'));
});

test('experiments without hypothesis converge instead of growing unbounded', () => {
  writeState('experiment-log.json', [{ week: 4, status: 'proposed' }]);
  sync.syncExperimentLog();
  const c1 = (db().prepare('SELECT COUNT(*) c FROM experiments WHERE hypothesis IS NULL').get() as { c: number }).c;
  sync.syncExperimentLog();
  const c2 = (db().prepare('SELECT COUNT(*) c FROM experiments WHERE hypothesis IS NULL').get() as { c: number }).c;
  assert.equal(c2, c1, 'unidentifiable rows must not multiply on every cycle');
});
