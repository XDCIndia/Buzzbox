import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Contract tests for src/lib/x-api.ts:
 *  - the module exports the three capabilities the app wires up
 *    (account analytics, mention search, posting);
 *  - postXTweet authenticates with the user-context access token (the same
 *    credential impressions use), not the app-only bearer. */

const stateDir = mkdtempSync(path.join(tmpdir(), 'hermes-x-api-contract-test-'));
process.env.HERMES_STATE_DIR = stateDir;

let xapi: typeof import('./x-api');

const origFetch = globalThis.fetch;
let fetchCalls: { url: string; init: RequestInit }[] = [];

before(async () => {
  xapi = await import('./x-api');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init: init ?? {} });
    if (url.includes('/2/tweets')) {
      return new Response(JSON.stringify({ data: { id: 'tweet-1', text: 'hi' } }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = origFetch;
  rmSync(stateDir, { recursive: true, force: true });
});

test('x-api exports account analytics, mention search, and posting', () => {
  assert.equal(typeof xapi.fetchXAccountAnalytics, 'function');
  assert.equal(typeof xapi.searchXMentions, 'function');
  assert.equal(typeof xapi.postXTweet, 'function');
});

test('postXTweet authenticates with the user-context access token', async () => {
  fetchCalls = [];
  const res = await xapi.postXTweet({ accessToken: 'user-token', text: 'hello from buzzbox' });
  assert.equal(res.id, 'tweet-1');
  const call = fetchCalls[0];
  assert.ok(call.url.includes('/2/tweets'));
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer user-token');
  assert.equal((call.init as { method?: string }).method, 'POST');
});
