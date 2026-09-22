import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #87: /api/content-item must resolve items from
 * content_posts (the table every real write path populates), not only the
 * never-populated content_queue_items.
 *
 * NOTE: dynamic imports AFTER env setup — src/lib/db.ts captures its database
 * path at module load, and static imports would point tests at the developer's
 * real database (see routes-api.test.ts for the full explanation). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-content-item-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.API_KEY = 'test-api-key';

let dbm: typeof import('./db');
let contentItemGet: typeof import('../app/api/content-item/route')['GET'];
let contentItemPatch: typeof import('../app/api/content-item/route')['PATCH'];
let db: ReturnType<typeof import('./db')['getDb']>;

const API = { 'x-api-key': 'test-api-key' };

before(async () => {
  dbm = await import('./db');
  const route = await import('../app/api/content-item/route');
  contentItemGet = route.GET;
  contentItemPatch = route.PATCH;
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function seedPost(id: string, status = 'draft'): void {
  db.prepare(
    `INSERT INTO content_posts (id, platform, format, status) VALUES (?, 'linkedin', 'post', ?)`
  ).run(id, status);
}

test('GET resolves an item that only exists in content_posts (#87)', async () => {
  seedPost('cp-only-posts-1');
  const res = await contentItemGet(
    new NextRequest('http://localhost/api/content-item?id=cp-only-posts-1', { headers: API }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.item.id, 'cp-only-posts-1');
  assert.equal(body.item.platform, 'linkedin');
});

test('GET still resolves content_queue_items rows (no regression)', async () => {
  db.prepare(
    `INSERT INTO content_queue_items (id, platform, format, status, queue_json) VALUES (?, 'x', 'post', 'draft', ?)`
  ).run('cq-1', JSON.stringify({ id: 'cq-1', platform: 'x', text: 'queue row' }));
  const res = await contentItemGet(
    new NextRequest('http://localhost/api/content-item?id=cq-1', { headers: API }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.item.id, 'cq-1');
  assert.equal(body.item.text, 'queue row');
});

test('GET returns 404 for genuinely missing ids', async () => {
  const res = await contentItemGet(
    new NextRequest('http://localhost/api/content-item?id=does-not-exist', { headers: API }),
  );
  assert.equal(res.status, 404);
});

test('PATCH updates an item that only exists in content_posts and writes both tables', async () => {
  seedPost('cp-only-posts-2', 'pending_approval');
  const res = await contentItemPatch(
    new NextRequest('http://localhost/api/content-item', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...API },
      body: JSON.stringify({ id: 'cp-only-posts-2', patch: { status: 'ready' } }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.item.status, 'ready');

  const post = db.prepare(`SELECT status FROM content_posts WHERE id = ?`).get('cp-only-posts-2') as { status: string };
  assert.equal(post.status, 'ready');
  const queue = db.prepare(`SELECT status FROM content_queue_items WHERE id = ?`).get('cp-only-posts-2') as { status: string };
  assert.equal(queue.status, 'ready');
});

test('PATCH still returns 404 when neither table nor file has the id', async () => {
  const res = await contentItemPatch(
    new NextRequest('http://localhost/api/content-item', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...API },
      body: JSON.stringify({ id: 'missing-item', patch: { status: 'ready' } }),
    }),
  );
  assert.equal(res.status, 404);
});
