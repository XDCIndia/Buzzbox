import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #180 (part 2): the digests API exposed only
 * GET and POST, so generated digests accumulated forever. DELETE is now
 * brand-scoped like the sibling child routes (#101): cross-brand ids 404.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-digest-delete-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

const BRAND = 'digest-brand-1';
const OTHER_BRAND = 'digest-brand-2';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type QueriesModule = typeof import('./brand-queries');
type DeleteRoute = typeof import('../app/api/brand/[brandId]/digests/[digestId]/route');
let dbm: DbModule;
let authm: AuthModule;
let queries: QueriesModule;
let digestDelete: DeleteRoute['DELETE'];
let adminCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function del(brandId: string, digestId: string): Promise<Response> {
  return digestDelete(
    new Request(`http://localhost/api/brand/${brandId}/digests/${digestId}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    }) as never,
    { params: Promise.resolve({ brandId, digestId }) } as never,
  );
}

function seedDigest(brandId: string, id: string): void {
  const db = dbm.getDb();
  db.prepare('INSERT OR IGNORE INTO brands (id, name, keywords, sources) VALUES (?, ?, ?, ?)').run(
    brandId, `Brand ${brandId}`, '[]', '[]',
  );
  db.prepare(
    'INSERT INTO brand_digests (id, brand_id, title, body, period_start, period_end) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, brandId, `Digest ${id}`, 'body', '2026-09-01', '2026-09-08');
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  queries = await imp<QueriesModule>('./brand-queries');
  digestDelete = (await imp<DeleteRoute>('../app/api/brand/[brandId]/digests/[digestId]/route')).DELETE;
  const db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const admin = authm.createUser('digest_admin', 'digest-admin-pass-99', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('DELETE removes an owned digest and 404s a second time (#180)', async () => {
  seedDigest(BRAND, 'ddel-1');
  const res = await del(BRAND, 'ddel-1');
  assert.equal(res.status, 200);
  assert.equal(queries.getBrandDigest('ddel-1'), null);

  const again = await del(BRAND, 'ddel-1');
  assert.equal(again.status, 404);
});

test('DELETE is brand-scoped: foreign ids 404 and survive (#180)', async () => {
  seedDigest(BRAND, 'ddel-2');
  seedDigest(OTHER_BRAND, 'ddel-3');
  const res = await del(BRAND, 'ddel-3');
  assert.equal(res.status, 404);
  assert.notEqual(queries.getBrandDigest('ddel-3'), null, 'foreign digest must survive');
  assert.notEqual(queries.getBrandDigest('ddel-2'), null, 'own digest untouched');
});

test('DELETE requires an editor session (#180)', async () => {
  seedDigest(BRAND, 'ddel-4');
  const res = await digestDelete(
    new Request(`http://localhost/api/brand/${BRAND}/digests/ddel-4`, { method: 'DELETE' }) as never,
    { params: Promise.resolve({ brandId: BRAND, digestId: 'ddel-4' }) } as never,
  );
  assert.equal(res.status, 401);
  assert.notEqual(queries.getBrandDigest('ddel-4'), null);
});
