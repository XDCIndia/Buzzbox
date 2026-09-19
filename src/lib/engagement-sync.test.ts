import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Tests for identity-based engagement dedup (#62).
 *
 * NOTE: db.ts/sync.ts capture paths at module load. All env vars are set at
 * the top and modules are dynamically imported inside before() (ESM hoists
 * static imports above the assignments — pointing tests at the dev DB). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-engagement-test-'));
const stateDir = path.join(tempDir, 'state');

process.env.HERMES_DB_PATH = path.join(tempDir, 'hermes-test.db');
process.env.HERMES_STATE_DIR = stateDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

type SyncModule = typeof import('./sync');
type DbModule = typeof import('./db');
let syncm: SyncModule;
let dbm: DbModule;
let db: ReturnType<DbModule['getDb']>;

function writeState(filename: string, data: unknown): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, filename), JSON.stringify(data), 'utf-8');
}

function count(where: string): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM engagements WHERE ${where}`).get() as { c: number }).c;
}

before(async () => {
  syncm = await import('./sync');
  dbm = await import('./db');
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('new engagement records are inserted even when many unrelated rows exist', async () => {
  // Inflated table: the old count-based check (items.length <= total rows)
  // would skip everything below.
  for (let i = 0; i < 10; i++) {
    db.prepare(
      "INSERT INTO engagements (platform, action_type, target_url, our_text, status) VALUES ('linkedin', 'comment', ?, ?, 'pending')",
    ).run(`https://linkedin.example/${i}`, `comment ${i}`);
  }

  writeState('engagement-log.json', [
    { platform: 'x', action_type: 'reply', target_url: 'https://x.example/1', our_text: 'nice thread', status: 'sent' },
  ]);
  syncm.syncEngagementLog();

  assert.equal(count("platform = 'x' AND target_url = 'https://x.example/1'"), 1);
});

test('repeated syncs are idempotent — no duplicates', async () => {
  writeState('engagement-log.json', [
    { platform: 'x', action_type: 'reply', target_url: 'https://x.example/2', our_text: 'hello' },
  ]);
  syncm.syncEngagementLog();
  syncm.syncEngagementLog();
  syncm.syncEngagementLog();

  assert.equal(count("platform = 'x' AND target_url = 'https://x.example/2'"), 1);
});

test('existing statuses are preserved on re-sync', async () => {
  db.prepare(
    "UPDATE engagements SET status = 'replied' WHERE platform = 'x' AND target_url = 'https://x.example/2'",
  ).run();

  // File still says 'sent' — the DB status must win for known records.
  writeState('engagement-log.json', [
    { platform: 'x', action_type: 'reply', target_url: 'https://x.example/2', our_text: 'hello', status: 'sent' },
  ]);
  syncm.syncEngagementLog();

  const row = db.prepare(
    "SELECT status FROM engagements WHERE platform = 'x' AND target_url = 'https://x.example/2'",
  ).get() as { status: string };
  assert.equal(row.status, 'replied');
});

test('engagement records with NULL target_url are matched correctly', async () => {
  writeState('engagement-log.json', [
    { platform: 'x', action_type: 'like', our_text: null, status: 'sent' },
  ]);
  syncm.syncEngagementLog();
  syncm.syncEngagementLog();

  assert.equal(count("platform = 'x' AND action_type = 'like' AND target_url IS NULL"), 1);
});

test('linkedin queue inserts new comments and preserves existing statuses', async () => {
  writeState('linkedin-comments-queue.json', [
    { target_url: 'https://li.example/post-a', our_text: 'great post', status: 'pending' },
  ]);
  syncm.syncLinkedInComments();
  assert.equal(count("platform = 'linkedin' AND target_url = 'https://li.example/post-a'"), 1);

  // Status advanced in the DB (human marked it done); file still says pending.
  db.prepare(
    "UPDATE engagements SET status = 'done' WHERE platform = 'linkedin' AND target_url = 'https://li.example/post-a'",
  ).run();

  writeState('linkedin-comments-queue.json', [
    { target_url: 'https://li.example/post-a', our_text: 'great post', status: 'pending' },
    { target_url: 'https://li.example/post-b', our_text: 'insightful', status: 'pending' },
  ]);
  syncm.syncLinkedInComments();

  const a = db.prepare(
    "SELECT status FROM engagements WHERE platform = 'linkedin' AND target_url = 'https://li.example/post-a'",
  ).get() as { status: string };
  assert.equal(a.status, 'done'); // preserved, not clobbered by the file
  assert.equal(count("platform = 'linkedin' AND target_url = 'https://li.example/post-b'"), 1);
});

test('linkedin comments removed from the file are removed from the DB', async () => {
  writeState('linkedin-comments-queue.json', [
    { target_url: 'https://li.example/post-b', our_text: 'insightful', status: 'pending' },
  ]);
  syncm.syncLinkedInComments();

  assert.equal(count("platform = 'linkedin' AND target_url = 'https://li.example/post-a'"), 0);
  assert.equal(count("platform = 'linkedin' AND target_url = 'https://li.example/post-b'"), 1);
});
