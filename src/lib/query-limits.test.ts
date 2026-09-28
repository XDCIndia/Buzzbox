import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #133: core list reads returned entire tables
 * as one JSON response (no LIMIT), risking full-table scans and OOM per
 * request. getEngagements/getSignals already capped at 200; the rest now
 * match that convention.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-query-limits-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;

type DbModule = typeof import('./db');
type QueriesModule = typeof import('./queries');
let dbm: DbModule;
let queries: QueriesModule;
let db: ReturnType<DbModule['getDb']>;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  queries = await imp<QueriesModule>('./queries');
  db = dbm.getDb();

  const leadInsert = db.prepare('INSERT INTO leads (id, status) VALUES (?, ?)');
  const postInsert = db.prepare("INSERT INTO content_posts (id, platform, format, status) VALUES (?, 'x', 'short_post', 'draft')");
  const insertMany = db.transaction(() => {
    for (let i = 0; i < 205; i++) {
      leadInsert.run(`limit-lead-${i}`, 'new');
      postInsert.run(`limit-post-${i}`);
    }
  });
  insertMany();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('getLeads caps results at 200 rows (#133)', () => {
  const rows = queries.getLeads({});
  assert.equal(rows.length, 200);
});

test('getContentPosts caps results at 200 rows (#133)', () => {
  const rows = queries.getContentPosts({});
  assert.equal(rows.length, 200);
});
