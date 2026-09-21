import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-ws-route-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const wsRoot = path.join(tempDir, 'workspace');

process.env.HERMES_DB_PATH = dbPath;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
process.env.HERMES_AGENT_WORKSPACE_DIR = wsRoot;

import { NextRequest } from 'next/server';

// NOTE: src/lib/db.ts captures its database path at module load, so every
// module that reads process.env at load time (db, auth, route handlers) must
// be dynamically imported inside before() AFTER the env vars above are set.
// Static imports would evaluate db.ts first (ESM hoisting) and silently point
// tests at the developer's real database. Same pattern as
// rbac-system-mutations.test.ts and routes-api.test.ts.
type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
let getDb: DbModule['getDb'];
let resetDbForTests: DbModule['resetDbForTests'];
let createSession: AuthModule['createSession'];
let createUser: AuthModule['createUser'];
let ensureAuthTables: AuthModule['ensureAuthTables'];
let GET: typeof import('../app/api/agents/workspace/route')['GET'];

before(async () => {
  const dbm = await import('./db');
  const authm = await import('./auth');
  const route = await import('../app/api/agents/workspace/route');
  getDb = dbm.getDb;
  resetDbForTests = dbm.resetDbForTests;
  createSession = authm.createSession;
  createUser = authm.createUser;
  ensureAuthTables = authm.ensureAuthTables;
  GET = route.GET;

  const files: Array<[string, string]> = [
    ['readme.md', '# hello'],
    ['notes/sub/page.md', 'page'],
    ['credentials/tokens.json', '{"token":"TEST-PLACEHOLDER"}'],
    ['.env', 'PLACEHOLDER=1'],
    ['state/agent-state.json', '{}'],
    ['logs/run.log', 'log'],
    ['sessions/s1.jsonl', '{}'],
    ['sandboxes/sb/x.txt', 'x'],
    ['sandbox/y.txt', 'y'],
    ['node_modules/pkg/index.js', 'm'],
    ['.hidden/nested.txt', 'h'],
    ['subdir/.dot/file.txt', 'd'],
    ['STATE/lower-case-check.json', '{}'],
  ];
  for (const [rel, content] of files) {
    const abs = path.join(wsRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
});

after(() => {
  resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});


function makeRequest(pathValue: string | null, headers: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/agents/workspace');
  if (pathValue !== null) url.searchParams.set('path', pathValue);
  return new NextRequest(url, { headers });
}

const ADMIN = { 'x-api-key': 'test-api-key' };

test('GET requires authentication', async () => {
  const res = await GET(makeRequest('readme.md'));
  assert.equal(res.status, 401);
});

test('legitimate workspace files remain readable', async () => {
  const res = await GET(makeRequest('readme.md', ADMIN));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.content, '# hello');

  const nested = await GET(makeRequest('notes/sub/page.md', ADMIN));
  assert.equal(nested.status, 200);
  const nestedBody = await nested.json();
  assert.equal(nestedBody.content, 'page');
});

test('authenticated viewer can still read legitimate files (auth unchanged)', async () => {
  const db = getDb();
  // Auth tables may not exist yet in a fresh test DB (they are created lazily by
  // ensureAuthTables on first user/session call), so ensure them before deleting.
  ensureAuthTables();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'viewer_ws_test';");
  const viewer = createUser('viewer_ws_test', 'viewer-password-123', 'viewer');
  const token = createSession(viewer.id);

  const res = await GET(makeRequest('readme.md', { cookie: `hermes-session=${token}` }));
  assert.equal(res.status, 200);
});

test('direct reads of hidden sensitive paths are rejected with 404', async () => {
  const hidden = [
    'credentials/tokens.json',
    '.env',
    'state/agent-state.json',
    'logs/run.log',
    'sessions/s1.jsonl',
    'sandboxes/sb/x.txt',
    'sandbox/y.txt',
    'node_modules/pkg/index.js',
    '.hidden/nested.txt',
    'subdir/.dot/file.txt',
    'STATE/lower-case-check.json',
    'credentials\\tokens.json',
    './credentials/tokens.json',
    'credentials./tokens.json',
    'state /agent-state.json',
  ];
  for (const p of hidden) {
    const res = await GET(makeRequest(p, ADMIN));
    assert.equal(res.status, 404, `expected 404 for ${JSON.stringify(p)}`);
    const body = await res.json();
    assert.equal(body.error, 'Not found');
  }
});

test('direct requests for hidden directories are rejected with 404', async () => {
  for (const p of ['credentials', 'state', 'logs', '.hidden']) {
    const res = await GET(makeRequest(p, ADMIN));
    assert.equal(res.status, 404, `expected 404 for directory ${JSON.stringify(p)}`);
  }
});

test('traversal attempts remain rejected with 400', async () => {
  for (const p of ['../outside.txt', 'a/../../b', '/etc/passwd']) {
    const res = await GET(makeRequest(p, ADMIN));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(p)}`);
    const body = await res.json();
    assert.equal(body.error, 'Invalid path');
  }
});

test('unknown but legitimate paths still return the existing 404 response', async () => {
  const res = await GET(makeRequest('does-not-exist.md', ADMIN));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'Not found');
});

test('directory listing still hides sensitive entries', async () => {
  const res = await GET(makeRequest(null, ADMIN));
  assert.equal(res.status, 200);
  const body = await res.json();
  const paths = (body.entries || []).map((e: { path: string }) => e.path);
  assert.ok(paths.includes('readme.md'), 'expected legit entry in listing');
  assert.ok(!paths.some((p: string) => p.split('/')[0].toLowerCase() === 'credentials'));
  assert.ok(!paths.some((p: string) => p.startsWith('.')));
});
