import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #181 (server half): the mention PATCH schema
 * accepted arbitrary strings for sentiment/emotion/intent, persisting values
 * the UI filters could never match. The fields are now enum-validated
 * against the edit UI's domain (brand-constants, shared with
 * sentiment-chip).
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-mention-patch-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

const BRAND_A = 'mpatch-brand-a';
const BRAND_B = 'mpatch-brand-b';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type QueriesModule = typeof import('./brand-queries');
type PatchRoute = typeof import('../app/api/brand/[brandId]/mentions/[mentionId]/route');
let dbm: DbModule;
let authm: AuthModule;
let bq: QueriesModule;
let patchRoute: PatchRoute['PATCH'];
let editorCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function seedMention(brandId: string, id: string): void {
  const db = dbm.getDb();
  db.prepare('INSERT OR IGNORE INTO brands (id, name, keywords, sources) VALUES (?, ?, ?, ?)').run(
    brandId, `Brand ${brandId}`, '[]', '[]',
  );
  bq.insertBrandMention({
    id, brand_id: brandId, source_type: 'social', platform: 'x',
    author_name: 'Author', author_handle: '@author', author_avatar_url: null, author_reach: 10,
    text: 'hello', url: 'http://example.com/m', likes: 0, comments: 0,
    sentiment: 'neutral', emotion: null, intent: null,
    is_crisis: false, is_high_impact: false, published_at: '2026-09-25 00:00:00',
  });
}

function patchReq(brandId: string, mentionId: string, body: unknown, cookie: string = editorCookie): Promise<Response> {
  return patchRoute(
    new Request(`http://localhost/api/brand/${brandId}/mentions/${mentionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ brandId, mentionId }) } as never,
  );
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  bq = await imp<QueriesModule>('./brand-queries');
  patchRoute = (await imp<PatchRoute>('../app/api/brand/[brandId]/mentions/[mentionId]/route')).PATCH;
  const db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const editor = authm.createUser('mpatch_editor', 'mpatch-editor-pass-99', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('valid sentiment/emotion/intent patch persists (#181)', async () => {
  seedMention(BRAND_A, 'mp-1');
  const res = await patchReq(BRAND_A, 'mp-1', { sentiment: 'positive', emotion: 'joy', intent: 'praise' });
  assert.equal(res.status, 200);
  const row = bq.getBrandMention(BRAND_A, 'mp-1');
  assert.equal(row?.sentiment, 'positive');
  assert.equal(row?.emotion, 'joy');
  assert.equal(row?.intent, 'praise');
});

test('off-enum values are rejected and the row is untouched (#181)', async () => {
  seedMention(BRAND_A, 'mp-2');
  for (const body of [{ sentiment: 'evil' }, { emotion: '' }, { intent: 'whatever' }, { sentiment: 'Positive' }]) {
    const res = await patchReq(BRAND_A, 'mp-2', body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  const row = bq.getBrandMention(BRAND_A, 'mp-2');
  assert.equal(row?.sentiment, 'neutral');
  assert.equal(row?.emotion, null);
  assert.equal(row?.intent, null);
});

test('cross-brand and missing mentions 404 without writing (#181)', async () => {
  seedMention(BRAND_A, 'mp-3');
  assert.equal((await patchReq(BRAND_B, 'mp-3', { sentiment: 'positive' })).status, 404);
  assert.equal((await patchReq(BRAND_A, 'mp-missing', { sentiment: 'positive' })).status, 404);
  assert.equal(bq.getBrandMention(BRAND_A, 'mp-3')?.sentiment, 'neutral');
});

test('unauthenticated patch is refused (#181)', async () => {
  seedMention(BRAND_A, 'mp-4');
  const res = await patchReq(BRAND_A, 'mp-4', { sentiment: 'positive' }, '');
  assert.equal(res.status, 401);
  assert.equal(bq.getBrandMention(BRAND_A, 'mp-4')?.sentiment, 'neutral');
});
