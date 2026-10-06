import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* POST /api/content — manual draft creation without any LLM/Buzz provider.
 *
 * Exercises the real route handler against an isolated temp DB (dynamic
 * imports AFTER env setup so db.ts never touches the developer database).
 * global fetch throws: the handler must create the draft with zero external
 * API calls, proving DICOMPUTE_API_KEY (or any provider) is not required. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-content-draft-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
delete process.env.DICOMPUTE_API_KEY;

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type Db = ReturnType<DbModule['getDb']>;
let dbm: DbModule;
let authm: AuthModule;
let contentPost: typeof import('../app/api/content/route')['POST'];
let db: Db;

const origFetch = globalThis.fetch;
let editorCookie = '';
let viewerCookie = '';

function postAs(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new NextRequest('http://localhost/api/content', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

before(async () => {
  dbm = await import('./db');
  authm = await import('./auth');
  contentPost = (await import('../app/api/content/route')).POST;
  db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username IN ('draft_editor', 'draft_viewer');");
  const editor = authm.createUser('draft_editor', 'editor-password-123', 'editor');
  const viewer = authm.createUser('draft_viewer', 'viewer-password-123', 'viewer');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
  viewerCookie = `hermes-session=${authm.createSession(viewer.id)}`;

  globalThis.fetch = (() => {
    throw new Error('no external API calls allowed in draft creation');
  }) as unknown as typeof fetch;
});

after(() => {
  globalThis.fetch = origFetch;
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('editor creates an X draft without any LLM provider configured', async () => {
  delete process.env.DICOMPUTE_API_KEY;
  const res = await contentPost(postAs({ text: 'hello manual draft', platform: 'x' }, editorCookie));
  assert.equal(res.status, 201);
  const body = (await res.json()) as { ok: boolean; draft: { id: string; platform: string; status: string; full_content: string } };
  assert.equal(body.ok, true);
  assert.equal(body.draft.platform, 'x');
  assert.equal(body.draft.status, 'draft');
  assert.equal(body.draft.full_content, 'hello manual draft');

  const row = db.prepare('SELECT platform, status, full_content FROM content_posts WHERE id = ?').get(body.draft.id) as
    | { platform: string; status: string; full_content: string }
    | undefined;
  assert.deepEqual(row, { platform: 'x', status: 'draft', full_content: 'hello manual draft' });

  // Saved as draft only: nothing published, no publish claim recorded.
  const claims = db.prepare('SELECT COUNT(*) AS c FROM x_publish_claims WHERE content_id = ?').get(body.draft.id) as { c: number };
  assert.equal(claims.c, 0);
});

test('empty or whitespace-only content is rejected', async () => {
  for (const text of ['', '   ', '\n\t ']) {
    const res = await contentPost(postAs({ text, platform: 'x' }, editorCookie));
    assert.equal(res.status, 400);
  }
});

test('unknown platform is rejected', async () => {
  const res = await contentPost(postAs({ text: 'hi', platform: 'myspace' }, editorCookie));
  assert.equal(res.status, 400);
});

test('unauthenticated requests are rejected', async () => {
  const res = await contentPost(postAs({ text: 'hi', platform: 'x' }));
  assert.equal(res.status, 401);
});

test('viewer role cannot create drafts', async () => {
  const res = await contentPost(postAs({ text: 'hi', platform: 'x' }, viewerCookie));
  assert.equal(res.status, 403);
});

test('malformed JSON is rejected without crashing', async () => {
  const res = await contentPost(
    new NextRequest('http://localhost/api/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: editorCookie },
      body: '{not json',
    }),
  );
  assert.equal(res.status, 400);
});
