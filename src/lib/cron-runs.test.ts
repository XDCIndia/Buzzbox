import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-cron-runs-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const openclawHome = path.join(tempDir, 'openclaw-home');
const runsDir = path.join(openclawHome, 'cron', 'runs');

process.env.HERMES_DB_PATH = dbPath;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
process.env.HERMES_OPENCLAW_HOME = openclawHome;

import { getDb, resetDbForTests } from './db';
import {
  createSession,
  createUser,
} from './auth';
import {
  getCronRunsDir,
  isPathInsideDir,
  resolveCronRunFilePath,
} from './cron-jobs';
import { GET } from '../app/api/cron/runs/route';
import { NextRequest } from 'next/server';

before(() => {
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    path.join(runsDir, 'testjob.jsonl'),
    `${JSON.stringify({ run: 1, ok: true })}\n${JSON.stringify({ run: 2, ok: false })}\n`,
    'utf-8',
  );
});

after(() => {
  resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeRequest(id: string | null, headers: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/cron/runs');
  if (id !== null) url.searchParams.set('id', id);
  return new NextRequest(url, { headers });
}

test('valid job ids resolve to files inside the cron runs dir', () => {
  for (const id of ['testjob', 'Test-Job_1', 'a', 'job9']) {
    const resolved = resolveCronRunFilePath(openclawHome, id);
    assert.ok(resolved, `expected ${id} to resolve`);
    const expected = path.join(getCronRunsDir(openclawHome), `${id}.jsonl`);
    assert.equal(path.resolve(resolved), path.resolve(expected));
    assert.equal(path.basename(resolved), `${id}.jsonl`);
  }
});

test('traversal and malformed ids are rejected', () => {
  const malicious = [
    '../test',
    '../../test',
    '..\\..\\test',
    '%2e%2e%2ftest',
    '%2e%2e/',
    '/etc/passwd',
    '\\windows\\evil',
    'C:\\Windows\\evil',
    'foo/bar',
    'foo\\bar',
    '.',
    '..',
    'id.jsonl',
    'has space',
    `${'a'.repeat(129)}`,
    '',
    '   ',
    '\0evil',
  ];
  for (const id of malicious) {
    assert.equal(resolveCronRunFilePath(openclawHome, id), null, `expected ${JSON.stringify(id)} to be rejected`);
  }
  assert.equal(resolveCronRunFilePath(openclawHome, null), null);
  assert.equal(resolveCronRunFilePath(openclawHome, undefined), null);
});

test('containment check rejects sibling directories that share a prefix', () => {
  const root = getCronRunsDir(openclawHome);
  const sibling = root + '-other';
  assert.equal(isPathInsideDir(root, path.join(sibling, 'x.jsonl')), false);
  assert.equal(isPathInsideDir(root, root), false);
  assert.equal(isPathInsideDir(root, path.join(root, 'x.jsonl')), true);
  assert.equal(isPathInsideDir(root, path.join(root, 'sub', 'x.jsonl')), true);
});

test('GET requires authentication', async () => {
  const res = await GET(makeRequest('testjob'));
  assert.equal(res.status, 401);
});

test('GET rejects authenticated viewers (manage_system is admin-only)', async () => {
  const db = getDb();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'viewer_runs_test';");
  const viewer = createUser('viewer_runs_test', 'viewer-password-123', 'viewer');
  const token = createSession(viewer.id);

  const res = await GET(makeRequest('testjob', { cookie: `hermes-session=${token}` }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'Access denied');
});

test('GET returns parsed runs for admin via x-api-key', async () => {
  const res = await GET(makeRequest('testjob', { 'x-api-key': 'test-api-key' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.runs, [{ run: 1, ok: true }, { run: 2, ok: false }]);
});

test('GET returns empty runs for unknown but valid id', async () => {
  const res = await GET(makeRequest('nosuchjob', { 'x-api-key': 'test-api-key' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.runs, []);
});

test('GET rejects traversal ids with 400', async () => {
  for (const id of ['../test', '..\\..\\test', '%2e%2e%2ftest', 'C:\\Windows\\evil', 'foo/bar']) {
    const res = await GET(makeRequest(id, { 'x-api-key': 'test-api-key' }));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(id)}`);
    const body = await res.json();
    assert.equal(body.error, 'Invalid id');
  }
});

test('GET rejects missing id with 400', async () => {
  const res = await GET(makeRequest(null, { 'x-api-key': 'test-api-key' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Missing id');
});
