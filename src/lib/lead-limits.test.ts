import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #183: POST/PATCH /api/leads silently sliced
 * over-length fields (first_name 80, title 120, company 160, linkedin_url
 * 400, notes 20000, …) and answered success — the stored record was quietly
 * truncated. Over-length values are now rejected with a field 400, and the
 * UI forms carry matching maxLength attributes.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-lead-limits-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type LeadsRoute = typeof import('../app/api/leads/route');
let dbm: DbModule;
let authm: AuthModule;
let leadsPost: LeadsRoute['POST'];
let leadsPatch: LeadsRoute['PATCH'];
let adminCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function leadCount(): number {
  return Number((dbm.getDb().prepare('SELECT COUNT(*) as c FROM leads').get() as { c: number }).c);
}

function post(body: unknown): Promise<Response> {
  return leadsPost(
    new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify(body),
    }) as never,
  );
}

function patch(body: unknown): Promise<Response> {
  return leadsPatch(
    new Request('http://localhost/api/leads', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify(body),
    }) as never,
  );
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  const leads = await imp<LeadsRoute>('../app/api/leads/route');
  leadsPost = leads.POST;
  leadsPatch = leads.PATCH;
  const db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const admin = authm.createUser('leadlim_admin', 'leadlim-admin-pass-99', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('POST rejects over-length fields with a field 400 and inserts nothing (#183)', async () => {
  const before = leadCount();
  for (const body of [
    { first_name: 'x'.repeat(81) },
    { last_name: 'y'.repeat(300) },
    { title: 't'.repeat(121) },
    { company: 'c'.repeat(161) },
    { company_size: 's'.repeat(41) },
    { industry_segment: 'i'.repeat(121) },
    { source: 's'.repeat(121) },
    { linkedin_url: `https://example.com/${'u'.repeat(400)}` },
    { notes: 'n'.repeat(20_001) },
  ]) {
    const res = await post({ last_name: 'Ok', ...body });
    assert.equal(res.status, 400, `expected 400 for ${Object.keys(body)[0]}`);
    assert.match(String((await res.json()).error), /Invalid/, 'field error names the problem');
  }
  assert.equal(leadCount(), before, 'rejected creates insert nothing');
});

test('POST accepts exact-cap and normal values (#183)', async () => {
  const atCap = await post({ first_name: 'x'.repeat(80), last_name: 'Cap', company: 'c'.repeat(160) });
  assert.equal(atCap.status, 200);
  const body = (await atCap.json()) as { lead: { first_name: string; company: string } };
  assert.equal(body.lead.first_name.length, 80);
  assert.equal(body.lead.company.length, 160);

  const normal = await post({ first_name: 'Ada', last_name: 'Lovelace' });
  assert.equal(normal.status, 200);
});

test('PATCH rejects over-length fields and leaves the row untouched (#183)', async () => {
  const created = (await (await post({ first_name: 'Grace', last_name: 'Hopper' })).json()) as {
    lead: { id: string };
  };
  const id = created.lead.id;

  const res = await patch({ id, company: 'c'.repeat(161) });
  assert.equal(res.status, 400);
  assert.match(String((await res.json()).error), /Invalid company/);

  const row = dbm.getDb().prepare('SELECT company FROM leads WHERE id = ?').get(id) as { company: null };
  assert.equal(row.company, null, 'failed patch writes nothing');

  const ok = await patch({ id, company: 'Navy' });
  assert.equal(ok.status, 200);
});
