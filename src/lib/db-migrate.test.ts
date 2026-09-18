import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/* Migration tests for the PRAGMA user_version runner in db.ts.
 *
 * Simulates a real legacy DB: one created by the pre-versioning code, which
 * always had the full v1 baseline (tables re-created with IF NOT EXISTS on
 * every boot) but never the v2 columns. We build that state by migrating a
 * fresh DB, stamping user_version back to 1, and dropping the v2 columns.
 *
 * Like the other DB-touching tests, db.ts is dynamically imported AFTER env
 * setup (see routes-api.test.ts for why). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-migrate-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

type DbModule = typeof import('./db');
let dbm: DbModule;

before(async () => {
  dbm = await import('./db');

  // Step 1: migrate a fresh DB to CURRENT, then rewind it to a realistic
  // pre-v2 state: full baseline schema, no v2 columns, user_version = 1.
  dbm.getDb();
  dbm.resetDbForTests();

  const rewind = new Database(dbPath);
  rewind.pragma('user_version = 1');
  // SQLite >= 3.35 supports DROP COLUMN (better-sqlite3 12.x bundles it).
  rewind.exec('ALTER TABLE leads DROP COLUMN pause_outreach');
  rewind.exec('ALTER TABLE content_posts DROP COLUMN image_url');
  // Legacy-era rows, shaped for the v1 schema.
  rewind.prepare(`INSERT INTO leads (id, first_name, status) VALUES ('legacy_1', 'Ada', 'approved')`).run();
  rewind.prepare(`INSERT INTO content_posts (id, platform, format, status) VALUES ('legacy_c1', 'x', 'post', 'draft')`).run();
  rewind.close();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('legacy (pre-v2) database upgrades to the current schema version', () => {
  const db = dbm.getDb(); // triggers migrate() against the rewound DB
  assert.equal(dbm.getSchemaVersion(db), dbm.CURRENT_SCHEMA_VERSION);
  assert.ok(dbm.CURRENT_SCHEMA_VERSION >= 2);
});

test('v2 columns are re-added to legacy tables', () => {
  const db = dbm.getDb();
  const leadCols = (db.pragma('table_info(leads)') as { name: string }[]).map(c => c.name);
  const postCols = (db.pragma('table_info(content_posts)') as { name: string }[]).map(c => c.name);
  assert.ok(leadCols.includes('pause_outreach'), 'leads.pause_outreach missing after migration');
  assert.ok(postCols.includes('image_url'), 'content_posts.image_url missing after migration');
});

test('legacy data survives the upgrade', () => {
  const db = dbm.getDb();
  const lead = db.prepare(`SELECT first_name, status FROM leads WHERE id = 'legacy_1'`).get() as
    | { first_name: string; status: string }
    | undefined;
  assert.deepEqual(lead, { first_name: 'Ada', status: 'approved' });

  const post = db.prepare(`SELECT platform, status FROM content_posts WHERE id = 'legacy_c1'`).get() as
    | { platform: string; status: string }
    | undefined;
  assert.deepEqual(post, { platform: 'x', status: 'draft' });
});

test('migrations are idempotent — reopening an up-to-date DB does not re-run them', () => {
  const db = dbm.getDb();
  const versionBefore = dbm.getSchemaVersion(db);
  dbm.resetDbForTests();

  const reopened = dbm.getDb(); // triggers migrate() again on the same file
  assert.equal(dbm.getSchemaVersion(reopened), versionBefore);
  const leadCount = (reopened.prepare(`SELECT COUNT(*) c FROM leads WHERE id = 'legacy_1'`).get() as { c: number }).c;
  assert.equal(leadCount, 1);
});
