import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #168: the mission-control cooldown (3s) and
 * 30-per-5-minute cap were check-then-act reads — N parallel sends all saw
 * stale counts, all passed, and each spawned a 120-second agent child.
 * The guard + user-message INSERT now run in one IMMEDIATE transaction
 * (claimMissionControlSend), so losers see the winner's row and get a 429
 * refusal instead of spawning another child.
 *
 * The child spawn itself is a real 120s-timeout subprocess, so these tests
 * target the claim helper directly — the race-relevant logic — without any
 * network or subprocess access.
 *
 * Dynamic imports AFTER env setup: db.ts captures its path at module load. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-mc-send-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;

type DbModule = typeof import('./db');
type McModule = typeof import('./mission-control-send');
let dbm: DbModule;
let mc: McModule;
let db: ReturnType<DbModule['getDb']>;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

const RATE_LIKE = '%"source":"mission-control"%';

function mcCount(username: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as c FROM messages WHERE from_agent = ? AND metadata LIKE ?',
  ).get(username, RATE_LIKE) as { c: number };
  return Number(row?.c ?? 0);
}

function send(username: string, content = 'hello orchestrator') {
  return mc.claimMissionControlSend({
    username,
    conversationId: 'mc:orchestrator',
    toAgent: 'orchestrator',
    content,
    mode: 'orchestrator',
  });
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  mc = await imp<McModule>('./mission-control-send');
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

test('concurrent sends serialize: loser gets cooldown instead of spawning a child (#168)', () => {
  // Old check-then-act shape: with no sends yet, two parallel readers both
  // see an empty window and would both pass the guard.
  const staleLast = db.prepare(
    'SELECT created_at FROM messages WHERE from_agent = ? AND metadata LIKE ? ORDER BY created_at DESC LIMIT 1',
  ).get('mc_racer', RATE_LIKE) as { created_at?: number } | undefined;
  const staleCount = db.prepare(
    'SELECT COUNT(*) as c FROM messages WHERE from_agent = ? AND metadata LIKE ?',
  ).get('mc_racer', RATE_LIKE) as { c: number };
  assert.equal(Number(staleLast?.created_at ?? 0), 0, 'stale read A passes');
  assert.equal(Number(staleCount?.c ?? 0), 0, 'stale read B passes');

  // Sequential commits through the atomic claim: the first wins, the second
  // sees the fresh row inside its IMMEDIATE transaction and is refused.
  send('mc_racer', 'first');
  assert.throws(() => send('mc_racer', 'second'), /Cooldown active/);
  assert.equal(mcCount('mc_racer'), 1, 'refused loser inserted nothing');
});

test('31st send inside the window is refused without inserting (#168)', () => {
  const username = 'mc_capped';
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
     VALUES ('mc:orchestrator', ?, 'orchestrator', ?, 'text', ?, ?)`,
  );
  // 30 sends spread 10..271s ago: most recent clears the 3s cooldown with
  // margin, oldest stays inside the 300s window with margin.
  for (let i = 0; i < 30; i += 1) {
    insert.run(username, `backfill ${i}`, '{"source":"mission-control"}', now - 10 - i * 9);
  }
  assert.throws(
    () => send(username, 'one too many'),
    /Rate limit exceeded for mission-control sends/,
  );
  assert.equal(mcCount(username), 30, 'refused send inserted nothing');
});

test('budgets are per-actor: another user is unaffected (#168)', () => {
  send('mc_actor_a');
  const receipt = send('mc_actor_b');
  assert.match(receipt.metadata, /"source":"mission-control"/);
  assert.equal(mcCount('mc_actor_a'), 1);
  assert.equal(mcCount('mc_actor_b'), 1);
});

test('successful claim records the rate-limit-visible row (#168)', () => {
  const receipt = send('mc_writer', 'do the thing');
  const row = db.prepare(
    'SELECT conversation_id, from_agent, to_agent, content, metadata, created_at FROM messages WHERE from_agent = ?',
  ).get('mc_writer') as {
    conversation_id: string;
    from_agent: string;
    to_agent: string;
    content: string;
    metadata: string;
    created_at: number;
  };
  assert.equal(row.conversation_id, 'mc:orchestrator');
  assert.equal(row.to_agent, 'orchestrator');
  assert.equal(row.content, 'do the thing');
  assert.equal(row.created_at, receipt.createdAt);
  assert.deepEqual(JSON.parse(row.metadata), {
    source: 'mission-control',
    mode: 'orchestrator',
    actor: 'mc_writer',
    from_agent: null,
    to_agent: null,
  });
});
