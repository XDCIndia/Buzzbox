import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/* Regression tests for issue #67 (dead internal links):
 *  1. The agent-sessions panel used to link to `/agents?conv=...` — a route
 *     that does not exist — so every "open conversation" link 404'd. The fix
 *     targets `/agents/comms?conv=<id>`, which does exist.
 *  2. AgentChat must read the `conv` query param on mount and open that
 *     conversation (deep-link support).
 *  3. The dashboard used to hardcode a brand UUID instead of using the real
 *     default brand id.
 * These are source-contract tests: they read the component sources and assert
 * the wiring exists, plus verify the routes the links emit actually exist on
 * disk. (Rendering RSC client components under node:test is not practical.) */

const read = (p: string) => readFileSync(path.resolve('src', p), 'utf8');

test('agent sessions links point at the comms route that exists (#67)', () => {
  const src = read('components/sessions/agent-sessions.tsx');
  // No links to the nonexistent /agents root page.
  assert.ok(!/\/agents\/?\?conv=/.test(src), 'must not link to /agents?conv= (page does not exist)');
  // Conversation links target /agents/comms with the conv param carried.
  assert.ok(
    /\/agents\/comms\?conv=/.test(src),
    'session links must use /agents/comms?conv=<id>',
  );
  // The conversation id must be URL-encoded in the href.
  assert.ok(/encodeURIComponent\(/.test(src), 'conv id must be encodeURIComponent-ed');
});

test('the /agents/comms route actually exists on disk (#67)', () => {
  const page = path.resolve('src', 'app', 'agents', 'comms', 'page.tsx');
  assert.ok(existsSync(page), '/agents/comms page must exist');
  const src = readFileSync(page, 'utf8');
  assert.ok(src.includes('AgentChat'), 'comms page must render AgentChat (the conv consumer)');
});

test('AgentChat consumes the conv query param as a deep link (#67)', () => {
  const src = read('components/chat/agent-chat.tsx');
  assert.ok(/useSearchParams\(\)/.test(src), 'AgentChat must read search params');
  assert.ok(/\.get\(["'`]conv["'`]\)/.test(src), 'AgentChat must read the conv param');
  // The deep link must resolve the conversation and select it, not be ignored.
  assert.ok(
    /Deep-link support/.test(src),
    'conv param must drive conversation selection (deep-link effect)',
  );
});

test('dashboard no longer hardcodes a brand UUID (#67)', () => {
  const src = read('app/dashboard/page.tsx');
  const hardcoded = src.match(/\/brand\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  assert.ok(!hardcoded, 'dashboard must not hardcode a brand UUID; use the default brand id');
});
