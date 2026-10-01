import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #172: rate-limit buckets keyed purely on the
 * client-controlled X-Forwarded-For header — rotating the header per request
 * minted a fresh bucket, bypassing the paid-LLM throttles.
 *
 * The header extractor is centralized in getClientIp, and the LLM routes
 * carry a per-user bucket beside the IP bucket, so header rotation alone no
 * longer buys quota. Login already had its login:user backstop.
 *
 * No test spends on LLMs: buzz sends carry an invalid body (400 after the
 * limit check), and dicompute-test stops at the 429 before askDicompute.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-xff-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

type RateModule = typeof import('./rate-limit');
type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type BuzzRoute = typeof import('../app/api/buzz/route');
type DicomputeRoute = typeof import('../app/api/dicompute-test/route');
let rate: RateModule;
let dbm: DbModule;
let authm: AuthModule;
let buzzPost: BuzzRoute['POST'];
let dicomputeGet: DicomputeRoute['GET'];
let adminCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function reqWithIp(url: string, ip: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { cookie: adminCookie };
  if (ip !== null) headers['x-forwarded-for'] = ip;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
  }
  return new Request(url, { headers });
}

before(async () => {
  rate = await imp<RateModule>('./rate-limit');
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  buzzPost = (await imp<BuzzRoute>('../app/api/buzz/route')).POST;
  dicomputeGet = (await imp<DicomputeRoute>('../app/api/dicompute-test/route')).GET;
  const db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const admin = authm.createUser('xff_admin', 'xff-admin-pass-99', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('getClientIp prefers first XFF entry, falls back, and caps length (#172)', () => {
  const mk = (headers: Record<string, string>) => new Request('http://localhost/', { headers });
  assert.equal(rate.getClientIp(mk({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })), '1.2.3.4');
  assert.equal(rate.getClientIp(mk({ 'x-forwarded-for': '  9.9.9.9  ' })), '9.9.9.9');
  assert.equal(rate.getClientIp(mk({ 'x-real-ip': '7.7.7.7' })), '7.7.7.7');
  assert.equal(rate.getClientIp(mk({})), 'unknown');
  assert.equal(rate.getClientIp(mk({ 'x-forwarded-for': '   ' })), 'unknown');
  const long = rate.getClientIp(mk({ 'x-forwarded-for': 'a'.repeat(500) }));
  assert.equal(long.length, rate.MAX_CLIENT_IP_LENGTH);
});

test('buzz: rotating XFF no longer bypasses the limit — user bucket binds (#172)', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    // Invalid body: 400 after the limit check, so no LLM is ever called.
    const res = await buzzPost(reqWithIp('http://localhost/api/buzz', `10.99.0.${i}`, {}) as never);
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(400), 'first 20 pass the limit (then fail validation)');
  assert.equal(statuses[20], 429, '21st refused despite a fresh spoofed IP');
  const body = (await (await buzzPost(reqWithIp('http://localhost/api/buzz', '10.99.9.9', {}) as never)).json()) as { error?: string };
  assert.match(String(body.error), /Too many Buzz requests/);
});

test('dicompute-test: rotating XFF no longer bypasses the limit (#172)', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const res = await dicomputeGet(reqWithIp('http://localhost/api/dicompute-test', `10.98.0.${i}`) as never);
    statuses.push(res.status);
  }
  assert.ok(statuses.slice(0, 10).every((s) => s !== 429), 'first 10 pass the limit');
  assert.equal(statuses[10], 429, '11th refused despite a fresh spoofed IP');
});
