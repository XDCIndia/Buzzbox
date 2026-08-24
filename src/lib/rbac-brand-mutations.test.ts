import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-rbac-brand-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
console.log('[rbac-brand] module eval, dbPath:', dbPath);

process.env.HERMES_DB_PATH = dbPath;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
// Ensure no social connectors are configured so mentions/sync stops at its
// 412 precondition instead of calling external services.
delete process.env.X_BEARER_TOKEN;
delete process.env.TIKTOK_ACCESS_TOKEN;
delete process.env.INSTAGRAM_ACCESS_TOKEN;
delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
delete process.env.REDDIT_CLIENT_ID;
delete process.env.REDDIT_CLIENT_SECRET;
delete process.env.REDDIT_USER_AGENT;

// NOTE: src/lib/db.ts captures its database path at module load, so db/auth
// and every route module must be dynamically imported inside before() AFTER
// the env vars above are configured.
type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
let dbm: DbModule;
let authm: AuthModule;
let brandPatch: typeof import('../app/api/brand/[brandId]/route')['PATCH'];
let alertsPost: typeof import('../app/api/brand/[brandId]/alerts/route')['POST'];
let alertDelete: typeof import('../app/api/brand/[brandId]/alerts/[alertId]/route')['DELETE'];
let alertCheckPost: typeof import('../app/api/brand/[brandId]/alerts/[alertId]/check/route')['POST'];
let campaignsPost: typeof import('../app/api/brand/[brandId]/campaigns/route')['POST'];
let campaignDelete: typeof import('../app/api/brand/[brandId]/campaigns/[campaignId]/route')['DELETE'];
let competitorsPost: typeof import('../app/api/brand/[brandId]/competitors/route')['POST'];
let competitorDelete: typeof import('../app/api/brand/[brandId]/competitors/[competitorId]/route')['DELETE'];
let digestsPost: typeof import('../app/api/brand/[brandId]/digests/route')['POST'];
let mentionPatch: typeof import('../app/api/brand/[brandId]/mentions/[mentionId]/route')['PATCH'];
let mentionsSyncPost: typeof import('../app/api/brand/[brandId]/mentions/sync/route')['POST'];

const BRAND_ID = 'brand_rbac_test';
let viewerCookie: string;
let editorCookie: string;
let adminCookie: string;

type Ctx<T extends Record<string, string>> = { params: Promise<T> };
function ctx<T extends Record<string, string>>(params: T): Ctx<T> {
  return { params: Promise.resolve(params) };
}
function req(url: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url), init as never);
}

function count(table: string): number {
  return (dbm.getDb().prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
}

// tsx emits CJS here, so dynamic imports wrap exports under `.default`.
async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<typeof import('./db')>('./db');
  authm = await imp<typeof import('./auth')>('./auth');
  brandPatch = (await imp<typeof import('../app/api/brand/[brandId]/route')>('../app/api/brand/[brandId]/route')).PATCH;
  alertsPost = (await imp<typeof import('../app/api/brand/[brandId]/alerts/route')>('../app/api/brand/[brandId]/alerts/route')).POST;
  alertDelete = (await imp<typeof import('../app/api/brand/[brandId]/alerts/[alertId]/route')>('../app/api/brand/[brandId]/alerts/[alertId]/route')).DELETE;
  alertCheckPost = (await imp<typeof import('../app/api/brand/[brandId]/alerts/[alertId]/check/route')>('../app/api/brand/[brandId]/alerts/[alertId]/check/route')).POST;
  campaignsPost = (await imp<typeof import('../app/api/brand/[brandId]/campaigns/route')>('../app/api/brand/[brandId]/campaigns/route')).POST;
  campaignDelete = (await imp<typeof import('../app/api/brand/[brandId]/campaigns/[campaignId]/route')>('../app/api/brand/[brandId]/campaigns/[campaignId]/route')).DELETE;
  competitorsPost = (await imp<typeof import('../app/api/brand/[brandId]/competitors/route')>('../app/api/brand/[brandId]/competitors/route')).POST;
  competitorDelete = (await imp<typeof import('../app/api/brand/[brandId]/competitors/[competitorId]/route')>('../app/api/brand/[brandId]/competitors/[competitorId]/route')).DELETE;
  digestsPost = (await imp<typeof import('../app/api/brand/[brandId]/digests/route')>('../app/api/brand/[brandId]/digests/route')).POST;
  mentionPatch = (await imp<typeof import('../app/api/brand/[brandId]/mentions/[mentionId]/route')>('../app/api/brand/[brandId]/mentions/[mentionId]/route')).PATCH;
  mentionsSyncPost = (await imp<typeof import('../app/api/brand/[brandId]/mentions/sync/route')>('../app/api/brand/[brandId]/mentions/sync/route')).POST;

  authm.ensureAuthTables();
  const db = dbm.getDb();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username LIKE 'rbac_%';");
  const viewer = authm.createUser('rbac_brand_viewer', 'viewer-password-123', 'viewer');
  viewerCookie = `hermes-session=${authm.createSession(viewer.id)}`;
  const editor = authm.createUser('rbac_brand_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
  const admin = authm.createUser('rbac_brand_admin', 'admin-password-123', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;

  db.prepare('INSERT INTO brands (id, name, keywords, sources) VALUES (?, ?, ?, ?)').run(
    BRAND_ID,
    'TestBrand',
    '[]',
    '[]',
  );
  db.prepare(
    `INSERT INTO brand_mentions (id, brand_id, source_type, platform, text) VALUES (?, ?, 'social', 'x', 'mention text')`,
  ).run('mention_rbac_test', BRAND_ID);
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('brand PATCH: unauthenticated 401, viewer 403 without DB change, editor/admin allowed', async () => {
  const call = (headers: Record<string, string>) =>
    brandPatch(req('http://localhost/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'RenamedBrand' }),
    }), ctx({ brandId: BRAND_ID }));

  assert.equal((await call({})).status, 401);

  assert.equal((await call({ cookie: viewerCookie })).status, 403);
  let name = (dbm.getDb().prepare('SELECT name FROM brands WHERE id = ?').get(BRAND_ID) as { name: string }).name;
  assert.equal(name, 'TestBrand', 'viewer must not be able to rename the brand');

  assert.equal((await call({ cookie: editorCookie })).status, 200);
  name = (dbm.getDb().prepare('SELECT name FROM brands WHERE id = ?').get(BRAND_ID) as { name: string }).name;
  assert.equal(name, 'RenamedBrand', 'editor rename should succeed');

  assert.equal((await call({ cookie: adminCookie })).status, 200);
});

test('alerts POST/DELETE: viewer denied without changes; editor/admin allowed', async () => {
  const postAlert = (headers: Record<string, string>) =>
    alertsPost(req('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'rbac-alert' }),
    }), ctx({ brandId: BRAND_ID }));

  assert.equal((await postAlert({})).status, 401);
  assert.equal((await postAlert({ cookie: viewerCookie })).status, 403);
  assert.equal(count('brand_alerts'), 0, 'viewer must not create alerts');

  const created = await postAlert({ cookie: editorCookie });
  assert.equal(created.status, 201);
  const alertId = (await created.json()).id as string;
  assert.equal(count('brand_alerts'), 1);

  assert.equal((await alertCheckPost(req('http://localhost/x', { method: 'POST', headers: { cookie: viewerCookie } }), ctx({ alertId }))).status, 403);
  const checkRes = await alertCheckPost(req('http://localhost/x', { method: 'POST', headers: { cookie: editorCookie } }), ctx({ alertId }));
  assert.equal(checkRes.status, 200);
  assert.ok(typeof (await checkRes.json()).matched === 'number');

  assert.equal((await alertDelete(req('http://localhost/x', { method: 'DELETE', headers: { cookie: viewerCookie } }), ctx({ alertId }))).status, 403);
  assert.equal(count('brand_alerts'), 1, 'viewer must not delete alerts');

  assert.equal((await alertDelete(req('http://localhost/x', { method: 'DELETE', headers: { cookie: editorCookie } }), ctx({ alertId }))).status, 200);
  assert.equal(count('brand_alerts'), 0);
});

test('campaigns POST/DELETE: viewer denied; editor/admin allowed', async () => {
  const postCampaign = (headers: Record<string, string>) =>
    campaignsPost(req('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'rbac-campaign' }),
    }), ctx({ brandId: BRAND_ID }));

  assert.equal((await postCampaign({})).status, 401);
  assert.equal((await postCampaign({ cookie: viewerCookie })).status, 403);
  assert.equal(count('brand_campaigns'), 0);

  const created = await postCampaign({ cookie: editorCookie });
  assert.equal(created.status, 201);
  const campaignId = (await created.json()).id as string;

  assert.equal((await campaignDelete(req('http://localhost/x', { method: 'DELETE', headers: { cookie: viewerCookie } }), ctx({ campaignId }))).status, 403);
  assert.equal(count('brand_campaigns'), 1);

  assert.equal((await campaignDelete(req('http://localhost/x', { method: 'DELETE', headers: { cookie: editorCookie } }), ctx({ campaignId }))).status, 200);
  assert.equal(count('brand_campaigns'), 0);
});

test('competitors POST/DELETE: viewer denied; editor allowed', async () => {
  const postCompetitor = (headers: Record<string, string>) =>
    competitorsPost(req('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'rbac-competitor' }),
    }), ctx({ brandId: BRAND_ID }));

  assert.equal((await postCompetitor({})).status, 401);
  assert.equal((await postCompetitor({ cookie: viewerCookie })).status, 403);
  assert.equal(count('brand_competitors'), 0);

  const created = await postCompetitor({ cookie: editorCookie });
  assert.equal(created.status, 201);
  const competitorId = (await created.json()).id as string;

  assert.equal((await competitorDelete(req('http://localhost/x', { method: 'DELETE', headers: { cookie: viewerCookie } }), ctx({ competitorId }))).status, 403);
  assert.equal(count('brand_competitors'), 1);

  assert.equal((await competitorDelete(req('http://localhost/x', { method: 'DELETE', headers: { cookie: editorCookie } }), ctx({ competitorId }))).status, 200);
  assert.equal(count('brand_competitors'), 0);
});

test('digests POST: viewer denied; editor allowed', async () => {
  const postDigest = (headers: Record<string, string>) =>
    digestsPost(req('http://localhost/x', { method: 'POST', headers }), ctx({ brandId: BRAND_ID }));

  assert.equal((await postDigest({})).status, 401);
  assert.equal((await postDigest({ cookie: viewerCookie })).status, 403);

  const res = await postDigest({ cookie: editorCookie });
  assert.equal(res.status, 201);
});

test('mention PATCH: viewer denied without change; editor allowed', async () => {
  const patch = (headers: Record<string, string>) =>
    mentionPatch(req('http://localhost/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ sentiment: 'negative' }),
    }), ctx({ mentionId: 'mention_rbac_test' }));

  assert.equal((await patch({})).status, 401);

  assert.equal((await patch({ cookie: viewerCookie })).status, 403);
  let sentiment = (dbm.getDb().prepare('SELECT sentiment FROM brand_mentions WHERE id = ?').get('mention_rbac_test') as { sentiment: string }).sentiment;
  assert.notEqual(sentiment, 'negative', 'viewer must not patch mentions');

  assert.equal((await patch({ cookie: editorCookie })).status, 200);
  sentiment = (dbm.getDb().prepare('SELECT sentiment FROM brand_mentions WHERE id = ?').get('mention_rbac_test') as { sentiment: string }).sentiment;
  assert.equal(sentiment, 'negative');
});

test('mentions sync POST: viewer/editor denied before connector checks; authorized roles reach 412 preconditions', async () => {
  const call = (headers: Record<string, string>) =>
    mentionsSyncPost(req('http://localhost/x', { method: 'POST', headers }), ctx({ brandId: BRAND_ID }));

  assert.equal((await call({})).status, 401);
  assert.equal((await call({ cookie: viewerCookie })).status, 403);
  assert.equal((await call({ cookie: editorCookie })).status, 412, 'editor passes auth and hits no-connector precondition');
  assert.equal((await call({ cookie: adminCookie })).status, 412);
});
