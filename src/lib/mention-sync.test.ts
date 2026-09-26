import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #121: mention sync searched only the first
 * keyword, fanned out to 7 providers serially, and always answered 200 --
 * embedding raw upstream error text -- even on total failure.
 *
 * The fan-out/response helpers are pure; the 412 precondition is exercised
 * through the route with all provider credentials unset.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-mention-sync-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
for (const v of [
  'X_BEARER_TOKEN', 'X_API_BEARER_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID',
  'THREADS_ACCESS_TOKEN', 'THREADS_USER_ID', 'YOUTUBE_API_KEY', 'INSTAGRAM_ACCESS_TOKEN',
  'INSTAGRAM_BUSINESS_ACCOUNT_ID', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_CLIENT_ID',
  'TIKTOK_CLIENT_SECRET', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT',
]) delete process.env[v];

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type SyncLib = typeof import('./mention-sync');
type SyncRoute = typeof import('../app/api/brand/[brandId]/mentions/sync/route');
let dbm: DbModule;
let authm: AuthModule;
let synclib: SyncLib;
let routePost: SyncRoute['POST'];
let editorCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  synclib = await imp<SyncLib>('./mention-sync');
  routePost = (await imp<SyncRoute>('../app/api/brand/[brandId]/mentions/sync/route')).POST;

  authm.ensureAuthTables();
  const db = dbm.getDb();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'msync_editor';");
  const editor = authm.createUser('msync_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
  db.prepare(`INSERT OR IGNORE INTO brands (id, name, keywords, sources) VALUES ('msync-brand', 'Msync', '["alpha", "beta"]', '[]')`).run();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('syncQueriesForBrand uses all keywords, deduped and capped (#121)', () => {
  assert.deepEqual(synclib.syncQueriesForBrand(['a', 'b', 'a', ' ', 'c'], 'Brand'), ['a', 'b', 'c']);
  assert.deepEqual(synclib.syncQueriesForBrand([], 'Brand'), ['Brand']);
  assert.deepEqual(synclib.syncQueriesForBrand(['  '], 'Brand'), ['Brand']);
  const many = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
  const capped = synclib.syncQueriesForBrand(many, 'Brand');
  assert.equal(capped.length, synclib.MAX_SYNC_KEYWORDS);
  assert.deepEqual(capped, many.slice(0, synclib.MAX_SYNC_KEYWORDS));
});

test('conciseProviderError strips bodies to one short line (#121)', () => {
  const raw = new Error('X API failed (401): <html>big body' + 'x'.repeat(5000) + '</html>\nsecond line');
  const concise = synclib.conciseProviderError(raw);
  assert.ok(!concise.includes('<html>'));
  assert.ok(!concise.includes('\n'));
  assert.ok(concise.length <= 200);
  assert.match(concise, /X API failed/);
  assert.equal(synclib.conciseProviderError('plain string'), 'plain string');
});

test('buildMentionSyncResponse is honest: 200, 207, 502 (#121)', () => {
  const ok = synclib.buildMentionSyncResponse(
    [{ platform: 'x', inserted: 3 }, { platform: 'reddit', inserted: 0 }],
    ['tiktok'],
    ['alpha'],
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { synced: 3, skipped: ['tiktok'], queries: ['alpha'] });

  const partial = synclib.buildMentionSyncResponse(
    [{ platform: 'x', inserted: 2 }, { platform: 'reddit', error: 'boom' }],
    [],
    ['alpha', 'beta'],
  );
  assert.equal(partial.status, 207);
  assert.deepEqual(partial.body, {
    synced: 2,
    skipped: [],
    queries: ['alpha', 'beta'],
    errors: { reddit: 'boom' },
  });

  const total = synclib.buildMentionSyncResponse([{ platform: 'x', error: 'down' }], ['tiktok'], ['alpha']);
  assert.equal(total.status, 502);
  assert.deepEqual(total.body.errors, { x: 'down' });
});

test('POST answers 412 with guidance when no connector is configured (#121)', async () => {
  const res = await routePost(
    new Request('http://localhost/api/brand/msync-brand/mentions/sync', {
      method: 'POST',
      headers: { cookie: editorCookie },
    }) as never,
    { params: Promise.resolve({ brandId: 'msync-brand' }) } as never,
  );
  assert.equal(res.status, 412);
  assert.match(String((await res.json()).error), /No social connector is configured/);
});

