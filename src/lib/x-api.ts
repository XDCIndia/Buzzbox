import { recordXSearchCall } from '@/lib/x-budget';

export interface XSummary {
  username: string;
  followers: number;
  following?: number;
  postsInRange: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export interface XSeriesPoint {
  date: string; // YYYY-MM-DD
  posts: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

interface XUserLookupResponse {
  data?: {
    id?: string;
    public_metrics?: {
      followers_count?: number | string;
      following_count?: number | string;
    };
  };
}

interface XTweet {
  created_at?: string;
  public_metrics?: {
    like_count?: number | string;
    reply_count?: number | string;
    retweet_count?: number | string;
    quote_count?: number | string;
  };
}

interface XTweetsResponse {
  data?: XTweet[];
  meta?: {
    next_token?: string;
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function xGet<T>(bearerToken: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    cache: "no-store",
  });
  // Counts against the daily search-call budget regardless of outcome --
  // the call was made (and consumed rate-limit quota) either way.
  recordXSearchCall(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function fetchXAccountAnalytics(opts: {
  bearerToken: string;
  username: string;
  days: number;
}): Promise<{ summary: XSummary; series: XSeriesPoint[] }> {
  const user = await xGet<XUserLookupResponse>(
    opts.bearerToken,
    `https://api.x.com/2/users/by/username/${encodeURIComponent(
      opts.username
    )}?user.fields=public_metrics`
  );

  const userId = user?.data?.id as string | undefined;
  if (!userId) throw new Error("X user lookup failed");

  const followers = num(user?.data?.public_metrics?.followers_count);
  const following = num(user?.data?.public_metrics?.following_count);

  const start = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  const startTime = start.toISOString();

  const buckets = new Map<string, XSeriesPoint>();
  for (let i = 0; i < opts.days; i++) {
    const d = new Date(Date.now() - (opts.days - 1 - i) * 24 * 60 * 60 * 1000);
    const key = isoDay(d);
    buckets.set(key, { date: key, posts: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 });
  }

  let nextToken: string | undefined;
  const maxPages = 5;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      max_results: "100",
      "tweet.fields": "created_at,public_metrics",
      exclude: "retweets,replies",
      start_time: startTime,
    });
    if (nextToken) params.set("pagination_token", nextToken);

    const tweets = await xGet<XTweetsResponse>(
      opts.bearerToken,
      `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`
    );

    const data = Array.isArray(tweets?.data) ? tweets.data : [];

    for (const t of data) {
      const created = typeof t?.created_at === "string" ? t.created_at : null;
      if (!created) continue;
      const day = created.slice(0, 10);
      const b = buckets.get(day);
      if (!b) continue;
      b.posts += 1;
      b.likes += num(t?.public_metrics?.like_count);
      b.replies += num(t?.public_metrics?.reply_count);
      b.reposts += num(t?.public_metrics?.retweet_count);
      b.quotes += num(t?.public_metrics?.quote_count);
    }

    nextToken = tweets?.meta?.next_token;
    if (!nextToken) break;
  }

  const series = Array.from(buckets.values());
  const summary = series.reduce(
    (acc, p) => {
      acc.postsInRange += p.posts;
      acc.likes += p.likes;
      acc.replies += p.replies;
      acc.reposts += p.reposts;
      acc.quotes += p.quotes;
      return acc;
    },
    {
      username: opts.username,
      followers,
      following,
      postsInRange: 0,
      likes: 0,
      replies: 0,
      reposts: 0,
      quotes: 0,
    } as XSummary
  );

  return { summary, series };
}

export interface XMentionResult {
  id: string;
  text: string;
  url: string;
  author_name: string | null;
  author_handle: string | null;
  author_reach: number;
  likes: number;
  comments: number;
  published_at: string | null;
}

interface XSearchUser {
  id?: string;
  name?: string;
  username?: string;
  public_metrics?: { followers_count?: number | string };
}

interface XSearchTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number | string;
    reply_count?: number | string;
  };
}

interface XSearchResponse {
  data?: XSearchTweet[];
  includes?: { users?: XSearchUser[] };
  meta?: { next_token?: string };
}

/** Searches recent public posts matching `query` (e.g. a brand keyword). Requires an X_BEARER_TOKEN with elevated search access. */
export async function searchXMentions(opts: {
  bearerToken: string;
  query: string;
  maxResults?: number;
}): Promise<XMentionResult[]> {
  const params = new URLSearchParams({
    query: `${opts.query} -is:retweet`,
    max_results: String(Math.min(Math.max(opts.maxResults ?? 50, 10), 100)),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name,public_metrics",
  });

  const res = await xGet<XSearchResponse>(
    opts.bearerToken,
    `https://api.x.com/2/tweets/search/recent?${params.toString()}`
  );

  const usersById = new Map<string, XSearchUser>();
  for (const u of res.includes?.users ?? []) {
    if (u.id) usersById.set(u.id, u);
  }

  return (res.data ?? []).map((t): XMentionResult => {
    const author = t.author_id ? usersById.get(t.author_id) : undefined;
    return {
      id: t.id || crypto.randomUUID(),
      text: t.text || '',
      url: author?.username && t.id ? `https://x.com/${author.username}/status/${t.id}` : '',
      author_name: author?.name ?? null,
      author_handle: author?.username ?? null,
      author_reach: num(author?.public_metrics?.followers_count),
      likes: num(t.public_metrics?.like_count),
      comments: num(t.public_metrics?.reply_count),
      published_at: t.created_at ?? null,
    };
  });
}

interface XPostTweetResponse {
  data?: { id?: string; text?: string };
}

export interface XPostResult {
  id: string;
  text: string;
}

/**
 * Publishes a tweet via POST https://api.x.com/2/tweets.
 *
 * IMPORTANT: unlike xGet's app-only bearer token (X_BEARER_TOKEN, used for
 * read-only analytics/search above), posting on behalf of an account
 * requires OAuth 1.0a user context or an OAuth 2.0 user-context access token
 * with the `tweet.write` scope. A plain app-only bearer token CANNOT post --
 * it will be rejected by the API. Callers must supply a distinct
 * user-context credential (e.g. from an `X_ACCESS_TOKEN` env var), never the
 * app-only `X_BEARER_TOKEN`.
 */
export async function postXTweet(opts: {
  accessToken: string;
  text: string;
}): Promise<XPostResult> {
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: opts.text }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`X post failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as XPostTweetResponse;
  const id = json?.data?.id;
  if (!id) throw new Error("X post succeeded but response had no tweet id");

  return { id, text: json?.data?.text ?? opts.text };
}
