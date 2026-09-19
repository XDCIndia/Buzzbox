import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Route-level tests: exercise real Next.js route handlers against an isolated
 * temp DB.
 *
 * NOTE: src/lib/db.ts captures its database path at module load. Static
 * imports would evaluate db.ts BEFORE the env assignments below (ESM hoists
 * imports), silently pointing tests at the developer's real database. All
 * env-reading modules (db, auth, route handlers) are therefore dynamically
 * imported inside before() AFTER the env vars are set — same pattern as
 * rbac-system-mutations.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-routes-api-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

type DbModule = typeof import('./db');
type Db = ReturnType<DbModule['getDb']>;
let dbm: DbModule;
let approvePost: typeof import('../app/api/automations/approve/route')['POST'];
let contentPatch: typeof import('../app/api/content/route')['PATCH'];
let leadsPost: typeof import('../app/api/leads/route')['POST'];
let brandPatch: typeof import('../app/api/brand/[brandId]/route')['PATCH'];
let db: Db;

const ADMIN = { 'x-api-key': 'test-api-key' };

before(async () => {
  dbm = await import('./db');
  const approveRoute = await import('../app/api/automations/approve/route');
  const contentRoute = await import('../app/api/content/route');
  const leadsRoute = await import('../app/api/leads/route');
  const brandRoute = await import('../app/api/brand/[brandId]/route');
  approvePost = approveRoute.POST;
  contentPatch = contentRoute.PATCH;
  leadsPost = leadsRoute.POST;
  brandPatch = brandRoute.PATCH;

  // Fresh temp DB — migrate() runs the full v1 baseline + v2 columns and
  // stamps PRAGMA user_version = CURRENT_SCHEMA_VERSION.
  db = dbm.getDb();
  assert.equal(dbm.getSchemaVersion(db), dbm.CURRENT_SCHEMA_VERSION);
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = ADMIN): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function seedLead(id: string, status: string): void {
  db.prepare(`INSERT INTO leads (id, first_name, status) VALUES (?, ?, ?)`).run(id, 'Test', status);
}

function seedSequence(id: string, leadId: string, status: string): void {
  db.prepare(`INSERT INTO sequences (id, lead_id, sequence_name, status) VALUES (?, ?, ?, ?)`)
    .run(id, leadId, 'intro', status);
}

function seedContent(id: string, status: string, platform = 'x'): void {
  db.prepare(
    `INSERT INTO content_posts (id, platform, format, status) VALUES (?, ?, 'post', ?)`
  ).run(id, platform, status);
}

function seqStatus(id: string): string | undefined {
  return (db.prepare(`SELECT status FROM sequences WHERE id = ?`).get(id) as { status?: string } | undefined)?.status;
}

function contentStatus(id: string): string | undefined {
  return (db.prepare(`SELECT status FROM content_posts WHERE id = ?`).get(id) as { status?: string } | undefined)?.status;
}

/* ── automations/approve: validation ──────────────────────────────────── */

test('approve rejects malformed JSON with 400 (not a 500 crash)', async () => {
  const req = new NextRequest('http://localhost/api/automations/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...ADMIN },
    body: '{not json',
  });
  const res = await approvePost(req);
  assert.equal(res.status, 400);
});

test('approve rejects invalid type with 400 and field issues', async () => {
  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'x', type: 'sms', action: 'approve' }),
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'Validation failed');
});

test('approve rejects missing fields with 400', async () => {
  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { type: 'content' }),
  );
  assert.equal(res.status, 400);
});

/* ── automations/approve: email sequences ─────────────────────────────── */

test('email sequence approval requires the lead to be approved first (409)', async () => {
  seedLead('lead_pending', 'new');
  seedSequence('seq_1', 'lead_pending', 'pending_approval');

  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'seq_1', type: 'email', action: 'approve' }),
  );
  assert.equal(res.status, 409);
  assert.equal(seqStatus('seq_1'), 'pending_approval');
});

test('email sequence approval moves pending_approval to approved', async () => {
  seedLead('lead_ok', 'approved');
  seedSequence('seq_2', 'lead_ok', 'pending_approval');

  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'seq_2', type: 'email', action: 'approve' }),
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(seqStatus('seq_2'), 'approved');
});

test('email sequence rejection moves pending_approval to cancelled', async () => {
  seedLead('lead_rej', 'new'); // lead status irrelevant for rejection
  seedSequence('seq_3', 'lead_rej', 'pending_approval');

  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'seq_3', type: 'email', action: 'reject' }),
  );
  assert.equal(res.status, 200);
  assert.equal(seqStatus('seq_3'), 'cancelled');
});

test('approval only affects pending_approval rows (no status clobbering)', async () => {
  seedLead('lead_ok2', 'approved');
  seedSequence('seq_4', 'lead_ok2', 'queued'); // not pending_approval

  await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'seq_4', type: 'email', action: 'approve' }),
  );
  assert.equal(seqStatus('seq_4'), 'queued');
});

/* ── automations/approve: content ─────────────────────────────────────── */

test('content approval moves pending_approval to ready', async () => {
  seedContent('c_1', 'pending_approval');

  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'c_1', type: 'content', action: 'approve' }),
  );
  assert.equal(res.status, 200);
  assert.equal(contentStatus('c_1'), 'ready');
});

test('content rejection moves pending_approval to rejected', async () => {
  seedContent('c_2', 'pending_approval');

  const res = await approvePost(
    jsonRequest('http://localhost/api/automations/approve', { id: 'c_2', type: 'content', action: 'reject' }),
  );
  assert.equal(res.status, 200);
  assert.equal(contentStatus('c_2'), 'rejected');
});

/* ── content PATCH: validation ────────────────────────────────────────── */

test('content PATCH rejects invalid status with 400', async () => {
  const res = await contentPatch(
    jsonRequest('http://localhost/api/content', { id: 'c_1', status: 'go-viral' }),
  );
  assert.equal(res.status, 400);
});

test('content PATCH rejects malformed JSON with 400', async () => {
  const req = new NextRequest('http://localhost/api/content', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...ADMIN },
    body: 'nope',
  });
  const res = await contentPatch(req);
  assert.equal(res.status, 400);
});

/* ── content PATCH: status transition ─────────────────────────────────── */

test('content PATCH transitions draft to ready', async () => {
  // Non-X platform: X posts entering 'ready' trigger the real publish path
  // (maybePublishToX), which is intentionally out of scope for this test.
  seedContent('c_3', 'draft', 'linkedin');

  const res = await contentPatch(
    jsonRequest('http://localhost/api/content', { id: 'c_3', status: 'ready' }),
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(contentStatus('c_3'), 'ready');
});

/* ── leads POST: invalid status/date rejected, not silently defaulted (#57) ── */

test('leads POST rejects invalid status instead of defaulting to new', async () => {
  const res = await leadsPost(jsonRequest('http://localhost/api/leads', { status: 'bogus' }));
  assert.equal(res.status, 400);
});

test('leads POST rejects invalid created_at instead of defaulting to now', async () => {
  const res = await leadsPost(jsonRequest('http://localhost/api/leads', { first_name: 'A', created_at: 'not-a-date' }));
  assert.equal(res.status, 400);
});

test('leads POST accepts a valid lead without status (defaults to new)', async () => {
  const res = await leadsPost(jsonRequest('http://localhost/api/leads', { first_name: 'Valid' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.lead.status, 'new');
  assert.ok(String(data.lead.id).startsWith('lead_'));
});

/* ── brand PATCH: keyword/source normalization (#58) ─────────────────── */

function patchRequest(brandId: string, body: unknown): Parameters<typeof brandPatch> {
  const req = new NextRequest(`http://localhost/api/brand/${brandId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...ADMIN },
    body: JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ brandId }) }];
}

function seedBrand(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO brands (id, name, keywords, sources) VALUES (?, 'Test Brand', '[]', '[]')",
  ).run(id);
}

test('brand PATCH trims keywords and drops empties', async () => {
  seedBrand('b_test');
  const res = await brandPatch(...patchRequest('b_test', {
    keywords: ['  ai  ', '', '   ', 'agents'],
  }));
  assert.equal(res.status, 200);
  const row = db.prepare("SELECT keywords FROM brands WHERE id = 'b_test'").get() as { keywords: string };
  assert.deepEqual(JSON.parse(row.keywords), ['ai', 'agents']);
});

test('brand PATCH rejects oversized name with 400', async () => {
  seedBrand('b_test');
  const res = await brandPatch(...patchRequest('b_test', { name: 'x'.repeat(121) }));
  assert.equal(res.status, 400);
});

test('brand PATCH rejects more than 100 keywords with 400', async () => {
  seedBrand('b_test');
  const res = await brandPatch(...patchRequest('b_test', {
    keywords: Array.from({ length: 101 }, (_, i) => `k${i}`),
  }));
  assert.equal(res.status, 400);
});

test('content PATCH on X posts entering ready requires publish preflight (412 without token)', async () => {
  seedContent('c_4', 'draft', 'x'); // fresh X approval → publish attempted

  const res = await contentPatch(
    jsonRequest('http://localhost/api/content', { id: 'c_4', status: 'ready' }),
  );
  // No X_ACCESS_TOKEN in the test env: the handler must refuse (412) rather
  // than silently flipping the status — X publishing is side-effectful.
  assert.equal(res.status, 412);
  assert.equal(contentStatus('c_4'), 'draft');
});
