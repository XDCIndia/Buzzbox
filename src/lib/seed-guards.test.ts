import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_BRAND_ID } from './brand-constants';

/* Regression tests for issue #102: `pnpm seed` wiped 16 tables with no
 * environment guard -- pointing HERMES_DB_PATH at production destroyed
 * operator data. The guards live in scripts/seed-guards.ts (side-effect
 * free) and are exercised here against a temp database.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-seed-guards-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;

type DbModule = typeof import('./db');
type SeedGuards = typeof import('../../scripts/seed-guards');
let dbm: DbModule;
let guards: SeedGuards;
let db: ReturnType<DbModule['getDb']>;

before(async () => {
  dbm = (await import('./db')) as DbModule;
  guards = (await import('../../scripts/seed-guards')) as SeedGuards;
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('parseSeedArgs: defaults deny, --force implies --yes (#102)', () => {
  assert.deepEqual(guards.parseSeedArgs([]), { force: false, yes: false });
  assert.deepEqual(guards.parseSeedArgs(['--yes']), { force: false, yes: true });
  assert.deepEqual(guards.parseSeedArgs(['-y']), { force: false, yes: true });
  assert.deepEqual(guards.parseSeedArgs(['--force']), { force: true, yes: true });
});

test('isProductionEnv only matches NODE_ENV=production (#102)', () => {
  assert.equal(guards.isProductionEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
  assert.equal(guards.isProductionEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
  assert.equal(guards.isProductionEnv({} as NodeJS.ProcessEnv), false);
});

test('empty database reports no non-seed rows (#102)', () => {
  assert.deepEqual(guards.findNonSeedRows(db), []);
});

test('unadopted placeholder brand is ignored, adopted brand is reported (#102)', () => {
  // Fresh migrate() inserts the DEFAULT_BRAND_ID placeholder row -- seeding
  // over it is the happy path, not data loss.
  assert.deepEqual(guards.findNonSeedRows(db), []);

  db.prepare(`UPDATE brands SET name = 'Acme Corp', is_demo = 0 WHERE id = ?`).run(DEFAULT_BRAND_ID);
  assert.deepEqual(guards.findNonSeedRows(db), [{ table: 'brands', count: 1 }]);

  db.prepare(`UPDATE brands SET name = 'My Brand', is_demo = 1 WHERE id = ?`).run(DEFAULT_BRAND_ID);
  assert.deepEqual(guards.findNonSeedRows(db), []);
});

test('untracked rows are reported per table, tracked rows are ignored (#102)', () => {
  db.prepare(`INSERT INTO leads (id) VALUES ('real-lead-1'), ('seed-lead-1')`).run();
  db.prepare(`INSERT INTO seed_registry (table_name, record_id) VALUES ('leads', 'seed-lead-1')`).run();
  db.prepare(`INSERT INTO suppression (email) VALUES ('operator@example.com')`).run();

  const found = guards.findNonSeedRows(db);
  assert.deepEqual(found, [
    { table: 'leads', count: 1 },
    { table: 'suppression', count: 1 },
  ]);

  db.exec(`DELETE FROM leads; DELETE FROM suppression; DELETE FROM seed_registry;`);
  assert.deepEqual(guards.findNonSeedRows(db), []);
});

test('missing registry treats every row as operator data (#102)', () => {
  db.prepare(`INSERT INTO leads (id) VALUES ('real-lead-2')`).run();
  db.exec('DROP TABLE seed_registry');
  assert.deepEqual(guards.findNonSeedRows(db), [{ table: 'leads', count: 1 }]);
});
