import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Regression tests for issue #60: session sync previously re-read the whole
 * file and sliced messages by COUNT(*) (duplicating on drift), stored
 * stat.size as the offset (consuming trailing partial lines), and used a
 * double-escaped cron-title regex that never matched.
 *
 * Dynamic imports AFTER env setup — see routes-api.test.ts. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-sync-sessions-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
// Single default instance rooted at the temp dir; filesystem agent discovery
// finds exactly the fixture agent dir we create.
process.env.HERMES_OPENCLAW_HOME = tempDir;
process.env.HERMES_USE_DEFAULT_AGENT_META = 'false';
delete process.env.HERMES_OPENCLAW_INSTANCES;
delete process.env.HERMES_AGENT_META_JSON;
delete process.env.HERMES_AGENT_META_PATH;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

let dbm: typeof import('./db');
let syncPost: typeof import('../app/api/chat/sync-sessions/route')['POST'];
let db: ReturnType<typeof import('./db')['getDb']>;

const AGENT = 'hermes';
const sessionsDir = path.join(tempDir, 'agents', AGENT, 'sessions');
const sessionFile = path.join(sessionsDir, 'test-session.jsonl');
const conversationId = `session:default:${AGENT}:test-session`;

function line(id: string, role: 'user' | 'assistant', text: string): string {
  return (
    JSON.stringify({
      type: 'message',
      id,
      timestamp: '2026-09-22T10:00:00Z',
      message: { role, content: [{ type: 'text', text }] },
    }) + '\n'
  );
}

function post(): Promise<Response> {
  return syncPost(new NextRequest('http://localhost/api/chat/sync-sessions', {
    method: 'POST',
    headers: { 'x-api-key': 'test-api-key' },
  }));
}

before(async () => {
  dbm = await import('./db');
  syncPost = (await import('../app/api/chat/sync-sessions/route')).POST;
  db = dbm.getDb();
  mkdirSync(sessionsDir, { recursive: true });
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('imports new lines, parses cron titles, stores byte-accurate offset (#60)', async () => {
  const l1 = line('e1', 'user', '[cron:daily-report Morning metrics digest]');
  const l2 = line('e2', 'assistant', 'Here is the digest.');
  writeFileSync(sessionFile, l1 + l2);

  const res = await post();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 2);

  const titles = db.prepare(`SELECT title FROM notifications WHERE type = 'session'`).all() as { title: string }[];
  assert.ok(titles.some((t) => t.title === 'Hermes: Morning metrics digest'), `cron title not parsed: ${JSON.stringify(titles)}`);

  const offset = db.prepare(`SELECT last_offset FROM session_sync WHERE session_file = ?`).get(sessionFile) as { last_offset: number };
  assert.equal(offset.last_offset, Buffer.byteLength(l1 + l2, 'utf-8'));
});

test('re-running the sync imports nothing (idempotent)', async () => {
  const res = await post();
  const body = await res.json();
  assert.equal(body.imported, 0);
  assert.equal(body.skipped, 1);
});

test('trailing partial line is left for the next sync, then imported once complete (#60)', async () => {
  const partial = line('e3', 'user', '[cron:daily-report Second run]').trimEnd(); // no newline
  appendFileSync(sessionFile, partial);

  const res1 = await post();
  const body1 = await res1.json();
  assert.equal(body1.imported, 0, 'partial trailing line must not be imported');

  appendFileSync(sessionFile, '\n');
  const res2 = await post();
  const body2 = await res2.json();
  assert.equal(body2.imported, 1);

  const count = db.prepare(`SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND json_extract(metadata, '$.entry_id') = 'e3'`).get(conversationId) as { c: number };
  assert.equal(count.c, 1);
});

test('drifted/zeroed offset does not duplicate rows (entry-id guard, #60)', async () => {
  db.prepare(`UPDATE session_sync SET last_offset = 0 WHERE session_file = ?`).run(sessionFile);

  const res = await post();
  const body = await res.json();
  assert.equal(body.imported, 0, 'entries already imported must be skipped despite offset drift');

  const count = db.prepare(`SELECT COUNT(*) c FROM messages WHERE conversation_id = ?`).get(conversationId) as { c: number };
  assert.equal(count.c, 3); // e1, e2, e3 — exactly once each
});
