import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #120: concurrent approves raced the draft ->
 * ready status read, so two requests could both post duplicate tweets (and
 * jointly overshoot the daily budget); a crash between the external post
 * and the DB persist retried into a second post.
 *
 * The claim table serializes publishers in SQLite itself; the busy and
 * already-posted paths return before any network access, so no X token or
 * HTTP stubbing is needed here.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-publish-claim-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
delete process.env.X_ACCESS_TOKEN;

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type PublishModule = typeof import('./publish-to-x');
let dbm: DbModule;
let authm: AuthModule;
let pub: PublishModule;
let db: ReturnType<DbModule['getDb']>;
let contentPatch: typeof import('../app/api/content/route')['PATCH'];
let editorCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function claims(id: string): { tweet_id: string | null }[] {
  return db.prepare('SELECT tweet_id FROM x_publish_claims WHERE content_id = ?').all(id) as {
    tweet_id: string | null;
  }[];
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  pub = await imp<PublishModule>('./publish-to-x');
  contentPatch = (await imp<typeof import('../app/api/content/route')>('../app/api/content/route')).PATCH;
  db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'xclaim_editor';");
  const editor = authm.createUser('xclaim_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;

  db.prepare(
    `INSERT OR REPLACE INTO content_posts (id, platform, format, status, text_preview) VALUES ('xclaim-1', 'x', 'short_post', 'draft', 'hello')`,
  ).run();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('claim lifecycle: claimed -> busy -> stale steal -> already-posted (#120)', () => {
  assert.deepEqual(pub.claimXPublish('c1'), { outcome: 'claimed' });
  assert.deepEqual(pub.claimXPublish('c1'), { outcome: 'busy' });

  db.prepare(`UPDATE x_publish_claims SET claimed_at = datetime('now', '-10 minutes') WHERE content_id = 'c1'`).run();
  assert.deepEqual(pub.claimXPublish('c1'), { outcome: 'claimed' });

  pub.completeXPublish('c1', 'tweet-123');
  assert.deepEqual(pub.claimXPublish('c1'), { outcome: 'already-posted', tweetId: 'tweet-123' });
  assert.deepEqual(claims('c1'), [{ tweet_id: 'tweet-123' }]);
});

test('releaseXPublish frees an unposted claim but never a completed one (#120)', () => {
  assert.deepEqual(pub.claimXPublish('c2'), { outcome: 'claimed' });
  pub.releaseXPublish('c2');
  assert.deepEqual(pub.claimXPublish('c2'), { outcome: 'claimed' });

  pub.completeXPublish('c2', 'tweet-456');
  pub.releaseXPublish('c2');
  assert.deepEqual(pub.claimXPublish('c2'), { outcome: 'already-posted', tweetId: 'tweet-456' });
});

test('maybePublishToX answers busy without network when a claim is held (#120)', async () => {
  assert.deepEqual(pub.claimXPublish('c3'), { outcome: 'claimed' });
  const res = await pub.maybePublishToX({
    contentId: 'c3',
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'ready',
    text: 'hello world',
  });
  assert.equal(res.attempted, true);
  assert.equal(res.ok, false);
  if (res.ok === false) {
    assert.equal(res.status, 409);
    assert.match(res.error, /already in progress/);
  }
  pub.releaseXPublish('c3');
});

test('maybePublishToX finalizes without reposting when already posted (#120)', async () => {
  assert.deepEqual(pub.claimXPublish('c4'), { outcome: 'claimed' });
  pub.completeXPublish('c4', 'tweet-789');
  const res = await pub.maybePublishToX({
    contentId: 'c4',
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'ready',
    text: 'hello world',
  });
  assert.deepEqual(res, { attempted: true, ok: true, tweetId: 'tweet-789', duplicate: true });
});

test('non-approval transitions claim nothing (#120)', async () => {
  const res = await pub.maybePublishToX({
    contentId: 'c5',
    platform: 'x',
    previousStatus: 'draft',
    nextStatus: 'draft',
    text: 'hello world',
  });
  assert.deepEqual(res, { attempted: false });
  assert.deepEqual(claims('c5'), []);
});

test("PATCH /api/content answers 409 when another publisher holds the claim (#120)", async () => {
  assert.deepEqual(pub.claimXPublish('xclaim-1'), { outcome: 'claimed' });
  const res = await contentPatch(
    new Request('http://localhost/api/content', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: editorCookie },
      body: JSON.stringify({ id: 'xclaim-1', status: 'ready' }),
    }) as never,
  );
  assert.equal(res.status, 409);
  assert.match(String((await res.json()).error), /already in progress/);

  // The concurrent loser changed nothing: still draft, nothing published.
  const row = db.prepare('SELECT status FROM content_posts WHERE id = ?').get('xclaim-1') as { status: string };
  assert.equal(row.status, 'draft');
  pub.releaseXPublish('xclaim-1');
});
