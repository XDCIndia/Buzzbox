// Meta's Threads API (graph.threads.net) is a *separate* API from the main
// Meta Graph API, though it shares a similar OAuth/access-token model. Unlike
// X's search/recent endpoint, it does NOT expose an open, cross-platform
// keyword search across all of Threads. The public API only lets an
// authorized account read activity that touches ITS OWN account:
//   - GET /{threads-user-id}/mentions  -> threads where this account was
//     tagged/mentioned or replied to (scoped to the authenticated account)
//   - GET /{threads-user-id}/threads_insights -> account-level metrics
//     (views, likes, replies, reposts, quotes, followers_count)
//
// There is no way, via the public Threads API, to search for an arbitrary
// brand keyword across posts made by other accounts the way searchXMentions
// does for X. This module is intentionally scoped to "mentions of our own
// authorized Threads account", not brand-wide keyword search.

const THREADS_API_BASE = "https://graph.threads.net/v1.0";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function threadsGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Threads API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface ThreadsMentionResult {
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

interface ThreadsMentionMedia {
  id?: string;
  text?: string;
  permalink?: string;
  username?: string;
  timestamp?: string;
}

interface ThreadsMentionsResponse {
  data?: ThreadsMentionMedia[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Fetches mentions/replies directed at the authenticated Threads account
 * (GET /{threads-user-id}/mentions). This is activity ON the owned account,
 * not a brand-keyword search across Threads at large -- see module header.
 *
 * The mentions endpoint does not return like/reply counts or the mentioning
 * author's follower count inline (those require a per-media insights call
 * and are not exposed for accounts you don't own), so `author_reach`,
 * `likes`, and `comments` are reported as 0 here.
 */
export async function fetchThreadsMentions(opts: {
  accessToken: string;
  threadsUserId: string;
  limit?: number;
}): Promise<ThreadsMentionResult[]> {
  const params = new URLSearchParams({
    fields: "id,text,permalink,username,timestamp",
    access_token: opts.accessToken,
  });
  if (opts.limit) params.set("limit", String(Math.min(Math.max(opts.limit, 1), 100)));

  const res = await threadsGet<ThreadsMentionsResponse>(
    `${THREADS_API_BASE}/${encodeURIComponent(opts.threadsUserId)}/mentions?${params.toString()}`
  );

  return (res.data ?? []).map((m): ThreadsMentionResult => ({
    id: m.id || crypto.randomUUID(),
    text: m.text || "",
    url: m.permalink || "",
    author_name: m.username ?? null,
    author_handle: m.username ?? null,
    author_reach: 0,
    likes: 0,
    comments: 0,
    published_at: m.timestamp ?? null,
  }));
}

export interface ThreadsSummary {
  threadsUserId: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  followersCount: number;
}

export interface ThreadsSeriesPoint {
  date: string; // YYYY-MM-DD
  views: number;
}

interface ThreadsInsightValue {
  value?: number;
  end_time?: string;
}

interface ThreadsInsightMetric {
  name?: string;
  period?: string;
  values?: ThreadsInsightValue[];
  total_value?: { value?: number };
}

interface ThreadsInsightsResponse {
  data?: ThreadsInsightMetric[];
}

/**
 * Fetches account-level Threads Insights (views/likes/replies/reposts/quotes,
 * plus followers_count) for the authenticated account, mirroring the
 * { summary, series } shape returned by fetchLinkedInOrgAnalytics.
 *
 * Only `views` supports a daily time-series breakdown on the Threads
 * Insights API -- likes/replies/reposts/quotes/followers_count are returned
 * as lifetime totals only, so the `series` array carries views per day and
 * the other metrics only appear in `summary`.
 */
export async function fetchThreadsInsights(opts: {
  accessToken: string;
  threadsUserId: string;
  days: number;
}): Promise<{ summary: ThreadsSummary; series: ThreadsSeriesPoint[] }> {
  const since = Math.floor((Date.now() - opts.days * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const params = new URLSearchParams({
    metric: "views,likes,replies,reposts,quotes,followers_count",
    since: String(since),
    until: String(until),
    access_token: opts.accessToken,
  });

  const res = await threadsGet<ThreadsInsightsResponse>(
    `${THREADS_API_BASE}/${encodeURIComponent(opts.threadsUserId)}/threads_insights?${params.toString()}`
  );

  const metrics = res.data ?? [];
  const byName = new Map(metrics.map((m) => [m.name, m]));

  const summary: ThreadsSummary = {
    threadsUserId: opts.threadsUserId,
    views: num(byName.get("views")?.total_value?.value),
    likes: num(byName.get("likes")?.total_value?.value),
    replies: num(byName.get("replies")?.total_value?.value),
    reposts: num(byName.get("reposts")?.total_value?.value),
    quotes: num(byName.get("quotes")?.total_value?.value),
    followersCount: num(byName.get("followers_count")?.total_value?.value),
  };

  const viewsMetric = byName.get("views");
  const series: ThreadsSeriesPoint[] = (viewsMetric?.values ?? [])
    .map((v) => ({ date: (v.end_time || "").slice(0, 10), views: num(v.value) }))
    .filter((p) => p.date);

  return { summary, series };
}
