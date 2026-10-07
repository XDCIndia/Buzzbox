import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_BRAND_ID } from './brand-constants';

/* Tests for issue #207: BrandMentionStats.lastSyncAt exposes the newest
 * brand_mentions.created_at in scope (i.e. last sync ingest), so the Brand
 * Overview can show stale data as stale instead of implying it is live.
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-brand-freshness-test-'));
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

function seedMention(id: string, source: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO brand_mentions (id, brand_id, source_type, platform, text, created_at)
     VALUES (?, ?, ?, 'x', ?, ?)`,
  ).run(id, DEFAULT_BRAND_ID, source, `mention ${id}`, createdAt);
}

test('lastSyncAt is the newest ingest across the brand', () => {
  seedMention('fresh-1', 'social', '2026-09-22 14:56:34');
  seedMention('fresh-2', 'social', '2026-10-01 09:00:00');
  seedMention('fresh-3', 'news', '2026-09-01 00:00:00');

  const stats = brandQueries.getBrandMentionStats(DEFAULT_BRAND_ID, {});
  assert.equal(stats.mentions, 3);
  assert.equal(stats.lastSyncAt, '2026-10-01 09:00:00');
});

test('lastSyncAt respects the source_type filter', () => {
  const stats = brandQueries.getBrandMentionStats(DEFAULT_BRAND_ID, { source_type: 'news' });
  assert.equal(stats.mentions, 1);
  assert.equal(stats.lastSyncAt, '2026-09-01 00:00:00');
});

test('lastSyncAt is null when the brand has no mentions', () => {
  db.prepare('DELETE FROM brand_mentions WHERE brand_id = ?').run(DEFAULT_BRAND_ID);
  const stats = brandQueries.getBrandMentionStats(DEFAULT_BRAND_ID, {});
  assert.equal(stats.mentions, 0);
  assert.equal(stats.lastSyncAt, null);
});
