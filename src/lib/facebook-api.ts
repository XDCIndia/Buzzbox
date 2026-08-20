// Meta Graph API client for a single owned Facebook Page.
//
// IMPORTANT SCOPE NOTE: unlike X's `/2/tweets/search/recent`, Meta's Graph API does not
// offer open keyword search across all of Facebook. A Page access token only grants
// access to that Page's own posts and the comments on them (plus content the Page has
// been tagged in, which requires additional review). So "mention discovery" here means:
// fetch the Page's recent posts, pull the comments on those posts, and keep the ones
// that mention the brand keyword client-side. That is the honest ceiling of what this
// API supports without Meta's discretionary, app-reviewed permissions.

const GRAPH_API_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface FacebookPageSummary {
  pageId: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  engagedUsers?: number;
  postEngagements?: number;
  engagementRatePct?: number;
}

export interface FacebookPageSeriesPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
  reach: number;
  engagedUsers: number;
  postEngagements: number;
}

export interface FacebookMentionResult {
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

interface FacebookInsightValue {
  value?: number | string;
  end_time?: string;
}

interface FacebookInsightMetric {
  name?: string;
  period?: string;
  values?: FacebookInsightValue[];
}

interface FacebookInsightsResponse {
  data?: FacebookInsightMetric[];
}

interface FacebookCommentFrom {
  id?: string;
  name?: string;
}

interface FacebookComment {
  id?: string;
  message?: string;
  from?: FacebookCommentFrom;
  created_time?: string;
  like_count?: number | string;
  comment_count?: number | string;
}

interface FacebookCommentsResponse {
  data?: FacebookComment[];
  paging?: { next?: string };
}

interface FacebookPost {
  id?: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
}

interface FacebookPostsResponse {
  data?: FacebookPost[];
  paging?: { next?: string };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function fbGet<T>(pageAccessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", pageAccessToken);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Facebook Graph API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Searches comments on the Page's own recent posts for a brand keyword. This is the
 * closest honest equivalent to X's mention search that the Graph API permits: there is
 * no cross-Facebook keyword search endpoint, only visibility into your own Page's posts
 * and their comments. Requires a Page access token with `pages_read_engagement` (and
 * `pages_show_list`) — most of these permissions require Meta App Review to use in
 * production.
 */
export async function searchFacebookPageMentions(opts: {
  pageAccessToken: string;
  pageId: string;
  query: string;
  maxResults?: number;
  maxPosts?: number;
}): Promise<FacebookMentionResult[]> {
  const maxResults = Math.min(Math.max(opts.maxResults ?? 50, 1), 200);
  const maxPosts = Math.min(Math.max(opts.maxPosts ?? 25, 1), 50);
  const needle = opts.query.trim().toLowerCase();

  const posts = await fbGet<FacebookPostsResponse>(opts.pageAccessToken, `/${encodeURIComponent(opts.pageId)}/posts`, {
    fields: "id,message,created_time,permalink_url",
    limit: String(maxPosts),
  });

  const results: FacebookMentionResult[] = [];

  for (const post of posts.data ?? []) {
    if (!post.id || results.length >= maxResults) break;

    const comments = await fbGet<FacebookCommentsResponse>(opts.pageAccessToken, `/${encodeURIComponent(post.id)}/comments`, {
      fields: "id,message,from,created_time,like_count,comment_count",
      filter: "stream",
      limit: "100",
    });

    for (const c of comments.data ?? []) {
      if (results.length >= maxResults) break;
      const message = c.message ?? "";
      if (!needle || !message.toLowerCase().includes(needle)) continue;
      if (!c.id) continue;

      results.push({
        id: c.id,
        text: message,
        url: post.permalink_url ? `${post.permalink_url}?comment_id=${c.id}` : "",
        author_name: c.from?.name ?? null,
        // Graph API does not expose a handle/username-style identifier for commenters.
        author_handle: null,
        // Graph API does not expose a commenter's follower count.
        author_reach: 0,
        likes: num(c.like_count),
        comments: num(c.comment_count),
        published_at: c.created_time ?? null,
      });
    }
  }

  return results;
}

/**
 * Fetches Page Insights (reach/engagement) for the given day range, mirroring the
 * shape of fetchLinkedInOrgAnalytics. Requires a Page access token with
 * `read_insights`. Intended for optional use on /analytics.
 */
export async function fetchFacebookPageInsights(opts: {
  pageAccessToken: string;
  pageId: string;
  days: number;
}): Promise<{ summary: FacebookPageSummary; series: FacebookPageSeriesPoint[] }> {
  const since = Math.floor((Date.now() - opts.days * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const insights = await fbGet<FacebookInsightsResponse>(opts.pageAccessToken, `/${encodeURIComponent(opts.pageId)}/insights`, {
    metric: "page_impressions,page_impressions_unique,page_engaged_users,page_post_engagements,page_fans",
    period: "day",
    since: String(since),
    until: String(until),
  });

  const buckets = new Map<string, FacebookPageSeriesPoint>();
  for (let i = 0; i < opts.days; i++) {
    const d = new Date(Date.now() - (opts.days - 1 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, impressions: 0, reach: 0, engagedUsers: 0, postEngagements: 0 });
  }

  let followers: number | undefined;

  for (const metric of insights.data ?? []) {
    for (const point of metric.values ?? []) {
      const day = typeof point.end_time === "string" ? point.end_time.slice(0, 10) : null;
      const value = num(point.value);

      if (metric.name === "page_fans") {
        // Lifetime metric — take the latest value as the current follower count.
        followers = value;
        continue;
      }

      if (!day) continue;
      const bucket = buckets.get(day);
      if (!bucket) continue;

      if (metric.name === "page_impressions") bucket.impressions = value;
      else if (metric.name === "page_impressions_unique") bucket.reach = value;
      else if (metric.name === "page_engaged_users") bucket.engagedUsers = value;
      else if (metric.name === "page_post_engagements") bucket.postEngagements = value;
    }
  }

  const series = Array.from(buckets.values());
  const totals = series.reduce(
    (acc, p) => {
      acc.impressions += p.impressions;
      acc.reach += p.reach;
      acc.engagedUsers += p.engagedUsers;
      acc.postEngagements += p.postEngagements;
      return acc;
    },
    { impressions: 0, reach: 0, engagedUsers: 0, postEngagements: 0 }
  );

  const engagementRatePct = totals.impressions > 0 ? (totals.postEngagements / totals.impressions) * 100 : 0;

  return {
    summary: {
      pageId: opts.pageId,
      followers,
      impressions: totals.impressions,
      reach: totals.reach,
      engagedUsers: totals.engagedUsers,
      postEngagements: totals.postEngagements,
      engagementRatePct,
    },
    series,
  };
}
