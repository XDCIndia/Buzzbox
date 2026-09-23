import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/* Tests for crisis/high-impact mention alerting:
 *  - evaluateMentionCrisis thresholds (>=50k reach + negative = crisis;
 *    >=100k reach any tone = high-impact; large+negative is crisis, not both)
 *  - insertMentionAlert writes a notifications row (mention_crisis critical /
 *    mention_high_impact warning) with mention id + url in data
 *  - insertBrandMention now reports freshness (true only on newly inserted
 *    rows), which the sync route uses to avoid duplicate alerts on re-sync
 *  - end-to-end through the sync route: a crisis fixture creates exactly one
 *    notification; re-running the sync must not duplicate the alert
 *
 * Dynamic imports AFTER env setup (ESM hoisting pollutes the live dev DB
 * otherwise — see routes-api.test.ts). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-mention-alerts-'));
const dbPath = path.join(tempDir, 'hermes-test.db');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.X_BEARER_TOKEN = 'test-bearer';
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';

let dbm: typeof import('./db');
let alerts: typeof import('./mention-alerts');
let bq: typeof import('./brand-queries');
let syncPost: typeof import('../app/api/brand/[brandId]/mentions/sync/route')['POST'];
let db: ReturnType<typeof import('./db')['getDb']>;

before(async () => {
  dbm = await import('./db');
  alerts = await import('./mention-alerts');
  bq = await import('./brand-queries');
  const route = await import('../app/api/brand/[brandId]/mentions/sync/route');
  syncPost = route.POST;
  db = dbm.getDb();
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

const NEGATIVE_BIG = 'This product is terrible and their support is a scam. Very disappointed.';
const POSITIVE_BIG = 'Honestly the best dashboard I have used all year, love it.';
const NEUTRAL_SMALL = 'There is an issue with my coffee machine this morning.';

test('evaluateMentionCrisis: large + negative => crisis', () => {
  assert.equal(alerts.evaluateMentionCrisis({ author_reach: 60_000, sentiment: 'negative' }), 'crisis');
});

test('evaluateMentionCrisis: >=100k reach any tone => high-impact (not crisis)', () => {
  assert.equal(alerts.evaluateMentionCrisis({ author_reach: 200_000, sentiment: 'positive' }), 'high-impact');
});

test('evaluateMentionCrisis: negative below threshold => null', () => {
  assert.equal(alerts.evaluateMentionCrisis({ author_reach: 5_000, sentiment: 'negative' }), null);
});

test('evaluateMentionCrisis: large + neutral (no negative words) => null', () => {
  assert.equal(alerts.evaluateMentionCrisis({ author_reach: 60_000, sentiment: 'neutral' }), null);
});

test('insertMentionAlert writes a crisis notification with metadata', () => {
  alerts.insertMentionAlert('crisis', {
    brandName: 'XDC Network',
    platform: 'x',
    author_name: 'Big Account',
    author_handle: 'bigaccount',
    text: NEGATIVE_BIG,
    url: 'https://x.com/bigaccount/status/123',
    mentionId: 'x_m1',
  });
  const row = db
    .prepare("SELECT * FROM notifications WHERE type = 'mention_crisis' ORDER BY id DESC LIMIT 1")
    .get() as { severity: string; title: string; message: string; data: string };
  assert.equal(row.severity, 'critical');
  assert.match(row.title, /@bigaccount/);
  assert.match(row.message, /terrible/);
  const data = JSON.parse(row.data) as { mention_id: string; url: string };
  assert.equal(data.mention_id, 'x_m1');
  assert.equal(data.url, 'https://x.com/bigaccount/status/123');
});

test('insertBrandMention reports freshness: true on insert, false on duplicate', () => {
  const base = {
    id: 'fm_1',
    brand_id: '97cdb115-2c90-42a8-b904-d14abce1d682',
    source_type: 'social' as const,
    platform: 'x' as const,
    author_name: 'A',
    author_handle: 'a',
    author_avatar_url: null,
    author_reach: 10,
    text: 'hello',
    url: null,
    likes: 0,
    comments: 0,
    sentiment: 'neutral' as const,
    emotion: 'neutral' as const,
    intent: null,
    is_crisis: false,
    is_high_impact: false,
    published_at: null,
  };
  assert.equal(bq.insertBrandMention(base), true);
  assert.equal(bq.insertBrandMention(base), false);
});

test('end-to-end: crisis mention in a sync creates exactly one notification; re-sync does not duplicate', async () => {
  const brandId = '97cdb115-2c90-42a8-b904-d14abce1d682';

  const bigCrisis = {
    id: '999001',
    text: NEGATIVE_BIG,
    author_name: 'Crisis Author',
    author_handle: 'crisisauthor',
    author_reach: 90_000,
    likes: 5,
    comments: 1,
    published_at: '2026-09-23T10:00:00.000Z',
    url: 'https://x.com/crisisauthor/status/999001',
  };
  const bigPositive = {
    id: '999002',
    text: POSITIVE_BIG,
    author_name: 'Fan Account',
    author_handle: 'fanaccount',
    author_reach: 150_000,
    likes: 50,
    comments: 2,
    published_at: '2026-09-23T10:01:00.000Z',
    url: 'https://x.com/fanaccount/status/999002',
  };
  const smallNoise = {
    id: '999003',
    text: NEUTRAL_SMALL,
    author_name: 'Small Account',
    author_handle: 'smallaccount',
    author_reach: 300,
    likes: 0,
    comments: 0,
    published_at: '2026-09-23T10:02:00.000Z',
    url: 'https://x.com/smallaccount/status/999003',
  };

  const searchPayload = {
    data: [bigCrisis, bigPositive, smallNoise].map((t) => ({
      id: t.id,
      text: t.text,
      created_at: t.published_at,
      author_id: t.id,
      public_metrics: { like_count: t.likes, reply_count: t.comments },
    })),
    includes: {
      users: [bigCrisis, bigPositive, smallNoise].map((t) => ({
        id: t.id,
        name: t.author_name,
        username: t.author_handle,
        public_metrics: { followers_count: t.author_reach },
      })),
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes('api.x.com/2/tweets/search/recent')) {
      return new Response(JSON.stringify(searchPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input as Request);
  }) as typeof fetch;

  const crisisBefore = (db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'mention_crisis'").get() as { n: number }).n;
  const hiBefore = (db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'mention_high_impact'").get() as { n: number }).n;

  try {
    const req = new NextRequest(`http://localhost/api/brand/${brandId}/mentions/sync`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-api-key' },
    });
    const res = await syncPost(req, { params: Promise.resolve({ brandId }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { synced: number };
    assert.equal(body.synced, 3);

    const crisis = db
      .prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'mention_crisis'")
      .get() as { n: number };
    assert.equal(crisis.n, crisisBefore + 1, 'exactly one new crisis notification');

    const hi = db
      .prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'mention_high_impact'")
      .get() as { n: number };
    assert.equal(hi.n, hiBefore + 1, 'exactly one new high-impact notification (the big positive)');

    const flagged = db
      .prepare('SELECT is_crisis, is_high_impact FROM brand_mentions WHERE id = ?')
      .get('x_999001') as { is_crisis: number; is_high_impact: number };
    assert.equal(flagged.is_crisis, 1);
    assert.equal(flagged.is_high_impact, 0, 'crisis takes precedence over high-impact');

    // Re-running the sync must not duplicate alerts (INSERT OR IGNORE + freshness gate).
    const res2 = await syncPost(
      new NextRequest(`http://localhost/api/brand/${brandId}/mentions/sync`, {
        method: 'POST',
        headers: { 'x-api-key': 'test-api-key' },
      }),
      { params: Promise.resolve({ brandId }) },
    );
    assert.equal(res2.status, 200);
    const crisis2 = db
      .prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'mention_crisis'")
      .get() as { n: number };
    assert.equal(crisis2.n, crisisBefore + 1, 'no duplicate crisis alert on re-sync');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
