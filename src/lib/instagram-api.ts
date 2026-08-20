// Instagram Graph API client.
//
// Requires a Business/Creator Instagram account linked to a Facebook Page,
// plus a long-lived access token with `instagram_basic`,
// `instagram_manage_comments`, and `pages_show_list` permissions. This app
// review flow is shared with the Facebook integration (issue #8) -- both
// connectors run through the same Meta app and should stay structurally
// consistent with each other.
//
// Env vars: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

export interface InstagramSummary {
  businessAccountId: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  profileViews?: number;
  likes?: number;
  comments?: number;
  engagementRatePct?: number;
}

export interface InstagramSeriesPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
}

export interface InstagramMentionResult {
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

interface IgAccountResponse {
  id?: string;
  followers_count?: number | string;
}

interface IgInsightValue {
  value?: number | string;
  end_time?: string;
}

interface IgInsightMetric {
  name?: string;
  values?: IgInsightValue[];
}

interface IgInsightsResponse {
  data?: IgInsightMetric[];
}

interface IgMediaNode {
  id?: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number | string;
  comments_count?: number | string;
  username?: string;
}

interface IgTaggedMediaResponse {
  data?: IgMediaNode[];
}

interface IgCommentNode {
  id?: string;
  text?: string;
  timestamp?: string;
  username?: string;
  like_count?: number | string;
}

interface IgCommentsResponse {
  data?: IgCommentNode[];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function igGet<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ access_token: accessToken, ...params });
  const res = await fetch(`${GRAPH_BASE}${path}?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Instagram API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetches account-level Insights (reach/engagement), mirroring the shape of
 * fetchLinkedInOrgAnalytics's return value.
 */
export async function fetchInstagramAccountAnalytics(opts: {
  accessToken: string;
  businessAccountId: string;
  days: number;
}): Promise<{ summary: InstagramSummary; series: InstagramSeriesPoint[] }> {
  const account = await igGet<IgAccountResponse>(opts.accessToken, `/${opts.businessAccountId}`, {
    fields: "id,followers_count",
  });
  const followers = num(account?.followers_count) || undefined;

  const since = Math.floor(Date.now() / 1000) - opts.days * 24 * 60 * 60;
  const until = Math.floor(Date.now() / 1000);

  const insights = await igGet<IgInsightsResponse>(
    opts.accessToken,
    `/${opts.businessAccountId}/insights`,
    {
      metric: "impressions,reach,profile_views",
      period: "day",
      since: String(since),
      until: String(until),
    }
  );

  const buckets = new Map<string, InstagramSeriesPoint>();
  for (let i = 0; i < opts.days; i++) {
    const d = new Date(Date.now() - (opts.days - 1 - i) * 24 * 60 * 60 * 1000);
    const key = isoDay(d);
    buckets.set(key, { date: key, impressions: 0, reach: 0, likes: 0, comments: 0 });
  }

  let totalImpressions = 0;
  let totalReach = 0;
  let profileViews = 0;

  for (const metric of insights.data ?? []) {
    for (const v of metric.values ?? []) {
      const day = typeof v.end_time === "string" ? v.end_time.slice(0, 10) : null;
      const value = num(v.value);
      if (metric.name === "profile_views") {
        profileViews += value;
        continue;
      }
      if (!day) continue;
      const b = buckets.get(day);
      if (!b) continue;
      if (metric.name === "impressions") {
        b.impressions += value;
        totalImpressions += value;
      } else if (metric.name === "reach") {
        b.reach += value;
        totalReach += value;
      }
    }
  }

  // Layer engagement (likes/comments) from recent media onto the same buckets.
  let totalLikes = 0;
  let totalComments = 0;
  try {
    const media = await igGet<{ data?: IgMediaNode[] }>(opts.accessToken, `/${opts.businessAccountId}/media`, {
      fields: "timestamp,like_count,comments_count",
      limit: "50",
    });
    for (const m of media.data ?? []) {
      const day = typeof m.timestamp === "string" ? m.timestamp.slice(0, 10) : null;
      const likes = num(m.like_count);
      const comments = num(m.comments_count);
      totalLikes += likes;
      totalComments += comments;
      if (!day) continue;
      const b = buckets.get(day);
      if (!b) continue;
      b.likes += likes;
      b.comments += comments;
    }
  } catch {
    // Media engagement is best-effort; insights above still return.
  }

  const engagementRatePct =
    totalReach > 0 ? ((totalLikes + totalComments) / totalReach) * 100 : 0;

  return {
    summary: {
      businessAccountId: opts.businessAccountId,
      followers,
      impressions: totalImpressions,
      reach: totalReach,
      profileViews,
      likes: totalLikes,
      comments: totalComments,
      engagementRatePct,
    },
    series: Array.from(buckets.values()),
  };
}

/**
 * Finds mentions/tags of the owned Business/Creator account: media where the
 * account was @mentioned or tagged, plus top-level comments on the account's
 * own media matching `query` (a brand keyword). The Graph API only exposes
 * mentions/tags on the *owned* account -- there is no keyword search across
 * all of Instagram, unlike X's recent-search endpoint.
 */
export async function searchInstagramMentions(opts: {
  accessToken: string;
  businessAccountId: string;
  query: string;
  maxResults?: number;
}): Promise<InstagramMentionResult[]> {
  const limit = Math.min(Math.max(opts.maxResults ?? 50, 10), 100);
  const results: InstagramMentionResult[] = [];

  const tagged = await igGet<IgTaggedMediaResponse>(
    opts.accessToken,
    `/${opts.businessAccountId}/tags`,
    { fields: "id,caption,permalink,timestamp,like_count,comments_count,username", limit: String(limit) }
  );

  for (const m of tagged.data ?? []) {
    if (!m.id) continue;
    results.push({
      id: m.id,
      text: m.caption || "",
      url: m.permalink || "",
      author_name: null,
      author_handle: m.username ?? null,
      author_reach: 0,
      likes: num(m.like_count),
      comments: num(m.comments_count),
      published_at: m.timestamp ?? null,
    });
  }

  // Also pull the account's own recent media and scan top-level comments for
  // the brand keyword, since @mentions inside comments aren't covered by the
  // `tags` edge above.
  try {
    const own = await igGet<{ data?: IgMediaNode[] }>(opts.accessToken, `/${opts.businessAccountId}/media`, {
      fields: "id",
      limit: String(limit),
    });

    const needle = opts.query.toLowerCase();
    for (const m of own.data ?? []) {
      if (!m.id) continue;
      const comments = await igGet<IgCommentsResponse>(opts.accessToken, `/${m.id}/comments`, {
        fields: "id,text,timestamp,username,like_count",
        limit: "50",
      });
      for (const c of comments.data ?? []) {
        if (!c.id || !c.text) continue;
        if (!c.text.toLowerCase().includes(needle)) continue;
        results.push({
          id: c.id,
          text: c.text,
          url: "",
          author_name: null,
          author_handle: c.username ?? null,
          author_reach: 0,
          likes: num(c.like_count),
          comments: 0,
          published_at: c.timestamp ?? null,
        });
      }
    }
  } catch {
    // Comment scanning is best-effort; tagged-media mentions above still return.
  }

  return results;
}
