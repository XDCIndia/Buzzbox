import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #106: workspace path containment used a
 * path.resolve prefix check with no symlink resolution, so a link planted
 * inside the root could exfiltrate or overwrite files outside it -- and the
 * write allowlist omitted sessions/sandboxes/sandbox, which listings hide.
 *
 * Junctions (not symlinks) keep this Windows-safe with no extra privilege.
 * Dynamic imports AFTER env setup -- db.ts captures its path at load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-ws-symlink-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const wsRoot = path.join(tempDir, 'workspace');
const outsideDir = path.join(tempDir, 'outside');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
process.env.HERMES_AGENT_WORKSPACE_DIR = wsRoot;
process.env.HERMES_ALLOW_WORKSPACE_WRITE = 'true';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type WorkspaceLib = typeof import('./agent-workspace');
let dbm: DbModule;
let authm: AuthModule;
let wslib: WorkspaceLib;
let GET: typeof import('../app/api/agents/workspace/route')['GET'];
let POST: typeof import('../app/api/agents/workspace/route')['POST'];
let PUT: typeof import('../app/api/agents/workspace/route')['PUT'];
let DELETE: typeof import('../app/api/agents/workspace/route')['DELETE'];
let viewerCookie: string;
let editorCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function apiUrl(pathValue: string | null, extra: Record<string, string> = {}): URL {
  const url = new URL('http://localhost/api/agents/workspace');
  if (pathValue !== null) url.searchParams.set('path', pathValue);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url;
}

function getReq(pathValue: string | null, headers: Record<string, string>): NextRequest {
  return new NextRequest(apiUrl(pathValue), { headers });
}

function jsonReq(method: string, body: unknown, headers: Record<string, string>): NextRequest {
  return new NextRequest(apiUrl(null), {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  wslib = await imp<WorkspaceLib>('./agent-workspace');
  const route = await imp<typeof import('../app/api/agents/workspace/route')>('../app/api/agents/workspace/route');
  GET = route.GET;
  POST = route.POST;
  PUT = route.PUT;
  DELETE = route.DELETE;

  authm.ensureAuthTables();
  dbm.getDb().exec("DELETE FROM sessions; DELETE FROM users WHERE username LIKE 'wssym_%';");
  const viewer = authm.createUser('wssym_viewer', 'viewer-password-123', 'viewer');
  viewerCookie = `hermes-session=${authm.createSession(viewer.id)}`;
  const editor = authm.createUser('wssym_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;

  mkdirSync(path.join(wsRoot, 'notes'), { recursive: true });
  writeFileSync(path.join(wsRoot, 'notes', 'ok.md'), '# legit', 'utf-8');
  mkdirSync(path.join(wsRoot, 'sessions'), { recursive: true });
  writeFileSync(path.join(wsRoot, 'sessions', 'keep.md'), 'session', 'utf-8');
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(path.join(outsideDir, 'secret.md'), 'OUTSIDE-SECRET', 'utf-8');
  symlinkSync(outsideDir, path.join(wsRoot, 'linkdir'), 'junction');
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('resolveWorkspaceRealPath contains escapes but resolves legit nested paths (#106)', async () => {
  assert.equal(await wslib.resolveWorkspaceRealPath(wsRoot, 'linkdir/secret.md'), null);
  assert.equal(await wslib.resolveWorkspaceRealPath(wsRoot, '../outside'), null);
  const legit = await wslib.resolveWorkspaceRealPath(wsRoot, 'notes/new.md');
  assert.ok(legit && legit.endsWith(path.join('notes', 'new.md')));
});

test('GET through an escaping symlink answers 404 without content (#106)', async () => {
  const res = await GET(getReq('linkdir/secret.md', { cookie: viewerCookie }));
  assert.equal(res.status, 404);

  const legit = await GET(getReq('notes/ok.md', { cookie: viewerCookie }));
  assert.equal(legit.status, 200);
  assert.equal((await legit.json()).content, '# legit');
});

test('GET listing skips escaping symlinks (#106)', async () => {
  const res = await GET(getReq(null, { cookie: viewerCookie }));
  assert.equal(res.status, 200);
  const body = await res.json();
  const paths = (body.entries as { path: string }[]).map(e => e.path);
  assert.ok(!paths.some(p => p === 'linkdir' || p.startsWith('linkdir/')));
  assert.ok(paths.some(p => p === 'notes/ok.md'));
});

test('PUT through an escaping symlink is rejected and the target is untouched (#106)', async () => {
  const res = await PUT(jsonReq('PUT', { path: 'linkdir/secret.md', content: 'PWNED' }, { cookie: editorCookie }));
  assert.equal(res.status, 400);
  assert.equal(readFileSync(path.join(outsideDir, 'secret.md'), 'utf-8'), 'OUTSIDE-SECRET');
});

test('POST through an escaping symlink is rejected with nothing created (#106)', async () => {
  const res = await POST(jsonReq('POST', { path: 'linkdir/evil.md', content: 'x' }, { cookie: editorCookie }));
  assert.equal(res.status, 400);
  assert.equal(existsSync(path.join(outsideDir, 'evil.md')), false);
});

test('DELETE through an escaping symlink is rejected and the target survives (#106)', async () => {
  const res = await DELETE(getReq('linkdir/secret.md', { cookie: editorCookie }));
  assert.equal(res.status, 400);
  assert.equal(existsSync(path.join(outsideDir, 'secret.md')), true);
});

test('writes to hidden session trees are rejected like listings hide them (#106)', async () => {
  const res = await POST(jsonReq('POST', { path: 'sessions/x.md', content: 'x' }, { cookie: editorCookie }));
  assert.equal(res.status, 400);
});

