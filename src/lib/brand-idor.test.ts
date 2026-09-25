import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #101: brand-scoped DELETE / check routes took
 * brandId from the URL but never scoped the query to it, so any editor who
 * knew an object id could delete or trigger another brand's alerts,
 * campaigns, competitors, or reclassify its mentions.
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-brand-idor-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type BrandQueries = typeof import('./brand-queries');
let dbm: DbModule;
let authm: AuthModule;
let bq: BrandQueries;
let db: ReturnType<DbModule['getDb']>;
let deleteAlertRoute: typeof import('../app/api/brand/[brandId]/alerts/[alertId]/route')['DELETE'];
let checkAlertRoute: typeof import('../app/api/brand/[brandId]/alerts/[alertId]/check/route')['POST'];

const BRAND_A = 'brand-a-idor';
const BRAND_B = 'brand-b-idor';
let editorCookie: string;

// tsx emits CJS here, so dynamic imports wrap exports under `.default`.
async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  bq = await imp<BrandQueries>('./brand-queries');
  deleteAlertRoute = (await imp<typeof import('../app/api/brand/[brandId]/alerts/[alertId]/route')>('../app/api/brand/[brandId]/alerts/[alertId]/route')).DELETE;
  checkAlertRoute = (await imp<typeof import('../app/api/brand/[brandId]/alerts/[alertId]/check/route')>('../app/api/brand/[brandId]/alerts/[alertId]/check/route')).POST;
  db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'idor_editor';");
  const editor = authm.createUser('idor_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;

  db.prepare('INSERT OR IGNORE INTO brands (id, name, keywords, sources) VALUES (?, ?, ?, ?)').run(BRAND_A, 'Brand A', '[]', '[]');
  db.prepare('INSERT OR IGNORE INTO brands (id, name, keywords, sources) VALUES (?, ?, ?, ?)').run(BRAND_B, 'Brand B', '[]', '[]');
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function routeReq(headers: Record<string, string> = {}): never {
  return new Request('http://localhost/test', { method: 'DELETE', headers }) as never;
}

test('cross-brand alert delete is rejected and the row survives (#101)', () => {
  const alert = bq.createBrandAlert(BRAND_A, { name: 'A alert', filters: {} });
  assert.equal(bq.deleteBrandAlert(BRAND_B, alert.id), false);
  assert.equal(bq.getBrandAlerts(BRAND_A).some(a => a.id === alert.id), true);
  assert.equal(bq.deleteBrandAlert(BRAND_A, alert.id), true);
  assert.equal(bq.getBrandAlerts(BRAND_A).some(a => a.id === alert.id), false);
});

test('cross-brand campaign and competitor deletes are rejected (#101)', () => {
  const campaign = bq.createBrandCampaign(BRAND_A, { name: 'A campaign', keywords: ['x'] });
  assert.equal(bq.deleteBrandCampaign(BRAND_B, campaign.id), false);
  assert.equal(bq.deleteBrandCampaign(BRAND_A, campaign.id), true);

  const competitor = bq.createBrandCompetitor(BRAND_A, 'Rival');
  assert.equal(bq.deleteBrandCompetitor(BRAND_B, competitor.id), false);
  assert.equal(bq.deleteBrandCompetitor(BRAND_A, competitor.id), true);
});

test('cross-brand alert check returns null; own-brand check runs (#101)', () => {
  const alert = bq.createBrandAlert(BRAND_A, { name: 'A check', filters: {} });
  assert.equal(bq.checkBrandAlert(BRAND_B, alert.id), null);
  // No mentions exist, so the own-brand check matches nothing but still runs.
  assert.deepEqual(bq.checkBrandAlert(BRAND_A, alert.id), { matched: 0 });
  bq.deleteBrandAlert(BRAND_A, alert.id);
});

test('cross-brand mention read/patch is rejected (#101)', () => {
  const mentionId = 'idor-mention-1';
  assert.equal(bq.insertBrandMention({
    id: mentionId, brand_id: BRAND_A, source_type: 'social', platform: 'x',
    author_name: 'Author', author_handle: '@author', author_avatar_url: null, author_reach: 10,
    text: 'hello', url: 'http://example.com/m', likes: 0, comments: 0,
    sentiment: 'neutral', emotion: null, intent: null,
    is_crisis: false, is_high_impact: false, published_at: '2026-09-25 00:00:00',
  }), true);

  assert.equal(bq.getBrandMention(BRAND_B, mentionId), null);
  assert.equal(bq.patchMention(BRAND_B, mentionId, { sentiment: 'positive' }), false);
  assert.equal(bq.patchMention(BRAND_A, mentionId, { sentiment: 'positive' }), true);
  assert.equal(bq.getBrandMention(BRAND_A, mentionId)?.sentiment, 'positive');
});

test('DELETE /api/brand/:victim/alerts/:id answers 404 cross-brand, 200 own-brand (#101)', async () => {
  const alert = bq.createBrandAlert(BRAND_A, { name: 'A routed', filters: {} });
  const ctxB = { params: Promise.resolve({ brandId: BRAND_B, alertId: alert.id }) };
  const cross = await deleteAlertRoute(routeReq({ cookie: editorCookie }), ctxB as never);
  assert.equal(cross.status, 404);

  const ctxA = { params: Promise.resolve({ brandId: BRAND_A, alertId: alert.id }) };
  const own = await deleteAlertRoute(routeReq({ cookie: editorCookie }), ctxA as never);
  assert.equal(own.status, 200);
  assert.equal((await own.json()).ok, true);
});

test('POST check route answers 404 cross-brand (#101)', async () => {
  const alert = bq.createBrandAlert(BRAND_A, { name: 'A check route', filters: {} });
  const req = new Request('http://localhost/test', { method: 'POST', headers: { cookie: editorCookie } }) as never;
  const cross = await checkAlertRoute(req, { params: Promise.resolve({ brandId: BRAND_B, alertId: alert.id }) } as never);
  assert.equal(cross.status, 404);
  const own = await checkAlertRoute(req, { params: Promise.resolve({ brandId: BRAND_A, alertId: alert.id }) } as never);
  assert.equal(own.status, 200);
  bq.deleteBrandAlert(BRAND_A, alert.id);
});
