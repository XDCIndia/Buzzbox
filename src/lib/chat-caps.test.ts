import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #169: agent-chat message bodies were unbounded
 * in both chat routes — megabytes accepted into TEXT columns and forwarded
 * as single CLI arguments to spawned children — while sibling fields were
 * stored verbatim with no allowlist.
 *
 * Content is capped at 4000 chars like buzz (#132); conversation_id at 200;
 * mc from_agent/to_agent and chat `to` at 100; chat message_type is an enum
 * matching ChatMessageType. Oversize/unknown values answer 400 and insert
 * nothing.
 *
 * No test triggers a real child spawn: chat sends omit `to` (no forward),
 * and mission-control sends only exercise the 400/429 paths.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-chat-caps-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
type McRoute = typeof import('../app/api/mission-control/chat/route');
type ChatRoute = typeof import('../app/api/chat/messages/route');
let dbm: DbModule;
let authm: AuthModule;
let mcPost: McRoute['POST'];
let chatPost: ChatRoute['POST'];
let db: ReturnType<DbModule['getDb']>;
let adminCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

function messageCount(): number {
  return Number((db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c);
}

function postTo(
  handler: (req: never) => Promise<Response>,
  url: string,
  body: unknown,
): Promise<Response> {
  return handler(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify(body),
    }) as never,
  );
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  mcPost = (await imp<McRoute>('../app/api/mission-control/chat/route')).POST;
  chatPost = (await imp<ChatRoute>('../app/api/chat/messages/route')).POST;
  db = dbm.getDb();

  authm.ensureAuthTables();
  db.exec('DELETE FROM sessions; DELETE FROM users;');
  const admin = authm.createUser('cap_admin', 'cap-admin-pass-99', 'admin');
  adminCookie = `hermes-session=${authm.createSession(admin.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('mission-control rejects content over 4000 chars without inserting (#169)', async () => {
  const before = messageCount();
  const res = await postTo(mcPost, 'http://localhost/api/mission-control/chat', {
    content: 'x'.repeat(4001),
  });
  assert.equal(res.status, 400);
  assert.equal(messageCount(), before, 'oversize send inserted nothing');
});

test('mission-control accepts exactly 4000 chars (blocked only by cooldown, not validation) (#169)', async () => {
  // Seed a fresh send so the claim refuses with 429 — proving the 4000-char
  // body passed validation (a validation failure would be 400 instead).
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
     VALUES ('mc:orchestrator', 'cap_admin', 'orchestrator', 'seed', 'text', ?, ?)`,
  ).run('{"source":"mission-control"}', now);
  const res = await postTo(mcPost, 'http://localhost/api/mission-control/chat', {
    content: 'y'.repeat(4000),
  });
  assert.equal(res.status, 429);
  assert.match(String((await res.json()).error), /Cooldown active/);
});

test('mission-control rejects oversize conversation_id and agent fields (#169)', async () => {
  for (const body of [
    { content: 'hi', conversation_id: 'c'.repeat(201) },
    { content: 'hi', from_agent: 'f'.repeat(101) },
    { content: 'hi', to_agent: 't'.repeat(101) },
  ]) {
    const res = await postTo(mcPost, 'http://localhost/api/mission-control/chat', body);
    assert.equal(res.status, 400, `expected 400 for ${Object.keys(body)[1]}`);
  }
});

test('chat messages rejects content over 4000 chars without inserting (#169)', async () => {
  const before = messageCount();
  const res = await postTo(chatPost, 'http://localhost/api/chat/messages', {
    content: 'x'.repeat(4001),
  });
  assert.equal(res.status, 400);
  assert.equal(messageCount(), before, 'oversize message inserted nothing');
});

test('chat messages accepts exactly 4000 chars (#169)', async () => {
  const res = await postTo(chatPost, 'http://localhost/api/chat/messages', {
    content: 'z'.repeat(4000),
    conversation_id: 'cap-conv-exact',
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { message: { content: string } };
  assert.equal(body.message.content.length, 4000);
});

test('chat messages allowlists message_type (#169)', async () => {
  const bad = await postTo(chatPost, 'http://localhost/api/chat/messages', {
    content: 'hi',
    message_type: 'evil',
    conversation_id: 'cap-conv-type',
  });
  assert.equal(bad.status, 400);

  const ok = await postTo(chatPost, 'http://localhost/api/chat/messages', {
    content: 'hi',
    message_type: 'handoff',
    conversation_id: 'cap-conv-type',
  });
  assert.equal(ok.status, 201);
  const body = (await ok.json()) as { message: { message_type: string } };
  assert.equal(body.message.message_type, 'handoff');
});

test('chat messages rejects oversize to and conversation_id (#169)', async () => {
  const before = messageCount();
  for (const body of [
    { content: 'hi', to: 't'.repeat(101), conversation_id: 'cap-conv-to' },
    { content: 'hi', conversation_id: 'c'.repeat(201) },
  ]) {
    const res = await postTo(chatPost, 'http://localhost/api/chat/messages', body);
    assert.equal(res.status, 400);
  }
  assert.equal(messageCount(), before, 'oversize fields inserted nothing');
});
