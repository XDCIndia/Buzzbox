import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_BRAND_ID } from './brand-constants';

/* Tests for issue #89: the brands.is_demo flag marks the seeded/migration
 * placeholder brand so the UI can label demo data clearly, and renaming the
 * brand (operator adoption) clears the flag.
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-brand-demo-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;

let dbm: typeof import('./db');
let brandQueries: typeof import('./brand-queries');
let db: ReturnType<typeof import('./db')['getDb']>;

before(async () => {
  dbm = await import('./db');
  brandQueries = await import('./brand-queries');
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function flagOf(id: string): number {
  return (db.prepare(`SELECT is_demo FROM brands WHERE id = ?`).get(id) as { is_demo: number }).is_demo;
}

test('v3 migration: the placeholder brand row is flagged is_demo=1', () => {
  // The migrate() fallback inserts 'My Brand' with the default id and is_demo=1.
  assert.equal(flagOf(DEFAULT_BRAND_ID), 1);
});

test('backfill targets the seeded demo name without touching renamed brands', () => {
  // Simulate a pre-v3 deployment whose default-brand row is still the seeded
  // demo name: unflag it, then verify the v3 UPDATE condition re-flags it...
  db.prepare(`UPDATE brands SET is_demo = 0, name = 'Hermes' WHERE id = ?`).run(DEFAULT_BRAND_ID);
  db.prepare(`UPDATE brands SET is_demo = 1 WHERE id = ? AND name IN ('Hermes', 'My Brand')`).run(DEFAULT_BRAND_ID);
  assert.equal(flagOf(DEFAULT_BRAND_ID), 1);

  // ...while an operator-renamed brand stays unflagged.
  db.prepare(`UPDATE brands SET is_demo = 0, name = 'Acme Corp' WHERE id = ?`).run(DEFAULT_BRAND_ID);
  db.prepare(`UPDATE brands SET is_demo = 1 WHERE id = ? AND name IN ('Hermes', 'My Brand')`).run(DEFAULT_BRAND_ID);
  assert.equal(flagOf(DEFAULT_BRAND_ID), 0);
});

test('renaming via updateBrand clears the demo flag (adoption)', () => {
  assert.equal(flagOf(DEFAULT_BRAND_ID), 0); // carried over from previous test
  db.prepare(`UPDATE brands SET is_demo = 1, name = 'Demo Brand (Hermes)' WHERE id = ?`).run(DEFAULT_BRAND_ID);

  brandQueries.updateBrand(DEFAULT_BRAND_ID, { name: 'Acme Corp' });
  const brand = brandQueries.getBrand(DEFAULT_BRAND_ID);
  assert.equal(brand?.name, 'Acme Corp');
  assert.equal(flagOf(DEFAULT_BRAND_ID), 0);
});

test('keyword/source-only updates leave the demo flag untouched', () => {
  db.prepare(`UPDATE brands SET is_demo = 1 WHERE id = ?`).run(DEFAULT_BRAND_ID);
  brandQueries.updateBrand(DEFAULT_BRAND_ID, { keywords: ['acme'] });
  assert.equal(flagOf(DEFAULT_BRAND_ID), 1);
});
