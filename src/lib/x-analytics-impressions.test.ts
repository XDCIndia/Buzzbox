import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Tests for impressions (non_public_metrics) support in the X account
 * analytics provider:
 *  - non_public_metrics is only requested when a user-context token is set
 *    AND the range is <= 7 days (X serves it only for recent posts);
 *  - the timeline call then switches to user-context auth;
 *  - per-post lifetime impressions are bucketed into daily series points and
 *    aggregated into summary.impressions;
 *  - without impressions data everything stays null (no fake zeros).
 *
 * fetch is mocked, so no network calls and no real X credentials are needed.
 * x-budget writes its JSON file into HERMES_STATE_DIR — pointed at a temp dir. */

const stateDir = mkdtempSync(path.join(tmpdir(), 'hermes-x-impressions-test-'));
process.env.HERMES_STATE_DIR = stateDir;

let xapi: typeof import('./x-api');
let xb: typeof import('./x-budget');

const origFetch = globalThis.fetch;
let fetchCalls: { url: string; init: RequestInit }[] = [];
let timelinePages: Record<string, unknown>[][] = [];

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function makeTweet(id: string, created: string, likes: number, impressions?: number): Record<string, unknown> {
  const t: Record<string, unknown> = {
    id,
    created_at: created,
    public_metrics: { like_count: likes, reply_count: 1, retweet_count: 2, quote_count: 0 },
  };
  if (impressions != null) t.non_public_metrics = { impression_count: impressions };
  return t;
}

before(async () => {
  xapi = await import('./x-api');
  xb = await import('./x-budget');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init: init ?? {} });
    if (url.includes('/users/by/username/')) {
      return new Response(
        JSON.stringify({ data: { id: 'uid-1', public_metrics: { followers_count: 1000, following_count: 5 } } }),
        { status: 200 },
      );
    }
    // Timeline endpoint: serve queued pages.
    const page = timelinePages.shift() ?? [];
    return new Response(JSON.stringify({ data: page }), { status: 200 });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = origFetch;
  rmSync(stateDir, { recursive: true, force: true });
});

function timelineCall(): { url: string; init: RequestInit } {
  const call = fetchCalls.find((c) => c.url.includes('/users/uid-1/tweets'));
  assert.ok(call, 'expected a user timeline call');
  return call;
}

test('app-only mode (no user token): no non_public_metrics requested, impressions stay null', async () => {
  fetchCalls = [];
  timelinePages = [[makeTweet('t1', hoursAgoIso(2), 10, 999)]];

  const { summary, series } = await xapi.fetchXAccountAnalytics({
    bearerToken: 'app-bearer',
    username: 'testuser',
    days: 30,
  });

  const call = timelineCall();
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer app-bearer');
  assert.ok(!call.url.includes('non_public_metrics'), 'app-only calls must not request non_public_metrics');
  assert.equal(summary.impressions, null);
  assert.ok(series.every((p) => p.impressions === null));
  // Public metrics unaffected.
  assert.equal(summary.likes, 10);
  assert.equal(summary.followers, 1000);
  assert.ok(xb); // budget module exercised via recordXSearchCall inside xGet
});

test('user-context token + <=7d range: non_public_metrics requested, bucketed and summed', async () => {
  fetchCalls = [];
  timelinePages = [[
    makeTweet('t1', hoursAgoIso(2), 10, 1000),
    makeTweet('t2', hoursAgoIso(3), 5, 250),
    makeTweet('t3', hoursAgoIso(26), 7, 400),
    makeTweet('t4', hoursAgoIso(50), 3, 300),
  ]];

  const { summary, series } = await xapi.fetchXAccountAnalytics({
    bearerToken: 'app-bearer',
    username: 'testuser',
    days: 7,
    userAccessToken: 'user-token',
  });

  const call = timelineCall();
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer user-token');
  assert.ok(call.url.includes('non_public_metrics'));

  const day0 = series.find((p) => p.date === hoursAgoIso(2).slice(0, 10));
  const day1 = series.find((p) => p.date === hoursAgoIso(26).slice(0, 10));
  const day2 = series.find((p) => p.date === hoursAgoIso(50).slice(0, 10));
  assert.equal(day0?.impressions, 1250); // 1000 + 250 on the same day
  assert.equal(day1?.impressions, 400);
  assert.equal(day2?.impressions, 300);
  assert.equal(summary.impressions, 1950);
  assert.equal(summary.postsInRange, 4);
});

test('user-context token + >7d range: falls back to app-only, impressions stay null', async () => {
  fetchCalls = [];
  timelinePages = [[makeTweet('t1', hoursAgoIso(24 * 6), 8, 500)]];

  const { summary } = await xapi.fetchXAccountAnalytics({
    bearerToken: 'app-bearer',
    username: 'testuser',
    days: 8,
    userAccessToken: 'user-token',
  });

  const call = timelineCall();
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer app-bearer');
  assert.ok(!call.url.includes('non_public_metrics'));
  assert.equal(summary.impressions, null);
});

test('summary.impressions is null when any day lacks impression data (no fabricated totals)', async () => {
  fetchCalls = [];
  timelinePages = [[
    makeTweet('t1', hoursAgoIso(2), 10, 1000),
    makeTweet('t2', hoursAgoIso(30), 5), // no non_public_metrics at all
  ]];

  const { summary } = await xapi.fetchXAccountAnalytics({
    bearerToken: 'app-bearer',
    username: 'testuser',
    days: 7,
    userAccessToken: 'user-token',
  });

  assert.equal(summary.impressions, null);
});
