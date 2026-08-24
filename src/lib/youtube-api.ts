// NOTE: comment-level mention search (matching the brand keyword inside video *comments*,
// not just titles/descriptions) is intentionally deferred to a later version -- it needs a
// commentThreads.list call per video, which is expensive on API quota.

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function ytGet<T>(url: string, opts?: { accessToken?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts?.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ─── Mention search (YouTube Data API v3, API-key only) ─────────────────────

export interface YouTubeMentionResult {
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

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
}

interface YouTubeVideoStatsItem {
  id?: string;
  statistics?: {
    likeCount?: string | number;
    commentCount?: string | number;
  };
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoStatsItem[];
}

interface YouTubeChannelStatsItem {
  id?: string;
  statistics?: {
    subscriberCount?: string | number;
  };
}

interface YouTubeChannelsResponse {
  items?: YouTubeChannelStatsItem[];
}

/**
 * Searches public videos whose title/description matches `query` (e.g. a brand keyword),
 * via search.list. Only needs an API key -- no OAuth required for public search.
 */
export async function searchYouTubeMentions(opts: {
  apiKey: string;
  query: string;
  maxResults?: number;
}): Promise<YouTubeMentionResult[]> {
  const searchParams = new URLSearchParams({
    part: "snippet",
    q: opts.query,
    type: "video",
    order: "date",
    maxResults: String(Math.min(Math.max(opts.maxResults ?? 25, 5), 50)),
    key: opts.apiKey,
  });

  const search = await ytGet<YouTubeSearchResponse>(
    `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`
  );

  const items = (search.items ?? []).filter((i) => i.id?.videoId);
  if (!items.length) return [];

  const videoIds = items.map((i) => i.id!.videoId as string);
  const channelIds = Array.from(
    new Set(items.map((i) => i.snippet?.channelId).filter((c): c is string => Boolean(c)))
  );

  const [videoStats, channelStats] = await Promise.all([
    ytGet<YouTubeVideosResponse>(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds
        .map(encodeURIComponent)
        .join(",")}&key=${opts.apiKey}`
    ),
    channelIds.length
      ? ytGet<YouTubeChannelsResponse>(
          `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds
            .map(encodeURIComponent)
            .join(",")}&key=${opts.apiKey}`
        )
      : Promise.resolve<YouTubeChannelsResponse>({ items: [] }),
  ]);

  const statsByVideoId = new Map<string, YouTubeVideoStatsItem>();
  for (const v of videoStats.items ?? []) {
    if (v.id) statsByVideoId.set(v.id, v);
  }
  const subscribersByChannelId = new Map<string, number>();
  for (const c of channelStats.items ?? []) {
    if (c.id) subscribersByChannelId.set(c.id, num(c.statistics?.subscriberCount));
  }

  return items.map((item): YouTubeMentionResult => {
    const videoId = item.id!.videoId as string;
    const snippet = item.snippet;
    const stats = statsByVideoId.get(videoId);
    const title = snippet?.title ?? "";
    const description = snippet?.description ?? "";

    return {
      id: videoId,
      text: description ? `${title}\n\n${description}` : title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author_name: snippet?.channelTitle ?? null,
      author_handle: snippet?.channelId ?? null,
      author_reach: snippet?.channelId ? subscribersByChannelId.get(snippet.channelId) ?? 0 : 0,
      likes: num(stats?.statistics?.likeCount),
      comments: num(stats?.statistics?.commentCount),
      published_at: snippet?.publishedAt ?? null,
    };
  });
}

// ─── Owned-channel analytics (YouTube Analytics API, requires OAuth) ────────

export interface YouTubeChannelSummary {
  channelId: string;
  subscribers?: number;
  views: number;
  estimatedMinutesWatched: number;
  likes: number;
  comments: number;
}

export interface YouTubeChannelSeriesPoint {
  date: string; // YYYY-MM-DD
  views: number;
  estimatedMinutesWatched: number;
  likes: number;
  comments: number;
}

interface YouTubeAnalyticsReportResponse {
  columnHeaders?: { name?: string }[];
  rows?: (string | number)[][];
}

/** Fetches core stats (views/subscribers/watch time) for an owned channel via the YouTube Analytics API. */
export async function fetchYouTubeChannelAnalytics(opts: {
  accessToken: string;
  channelId: string;
  days: number;
}): Promise<{ summary: YouTubeChannelSummary; series: YouTubeChannelSeriesPoint[] }> {
  let subscribers: number | undefined;
  try {
    const channelStats = await ytGet<YouTubeChannelsResponse>(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(
        opts.channelId
      )}`,
      { accessToken: opts.accessToken }
    );
    const parsed = num(channelStats.items?.[0]?.statistics?.subscriberCount);
    if (parsed > 0) subscribers = parsed;
  } catch {
    // ignore -- subscriber count is best-effort
  }

  const end = new Date();
  const start = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);

  const reportParams = new URLSearchParams({
    ids: `channel==${opts.channelId}`,
    startDate: isoDay(start),
    endDate: isoDay(end),
    metrics: "views,estimatedMinutesWatched,likes,comments",
    dimensions: "day",
    sort: "day",
  });

  const report = await ytGet<YouTubeAnalyticsReportResponse>(
    `https://youtubeanalytics.googleapis.com/v2/reports?${reportParams.toString()}`,
    { accessToken: opts.accessToken }
  );

  const headers = (report.columnHeaders ?? []).map((h) => h.name ?? "");
  const dayIdx = headers.indexOf("day");
  const viewsIdx = headers.indexOf("views");
  const minutesIdx = headers.indexOf("estimatedMinutesWatched");
  const likesIdx = headers.indexOf("likes");
  const commentsIdx = headers.indexOf("comments");

  const series: YouTubeChannelSeriesPoint[] = (report.rows ?? []).map((row) => ({
    date: dayIdx >= 0 ? String(row[dayIdx]) : "",
    views: viewsIdx >= 0 ? num(row[viewsIdx]) : 0,
    estimatedMinutesWatched: minutesIdx >= 0 ? num(row[minutesIdx]) : 0,
    likes: likesIdx >= 0 ? num(row[likesIdx]) : 0,
    comments: commentsIdx >= 0 ? num(row[commentsIdx]) : 0,
  }));

  const summary = series.reduce(
    (acc, p) => {
      acc.views += p.views;
      acc.estimatedMinutesWatched += p.estimatedMinutesWatched;
      acc.likes += p.likes;
      acc.comments += p.comments;
      return acc;
    },
    {
      channelId: opts.channelId,
      subscribers,
      views: 0,
      estimatedMinutesWatched: 0,
      likes: 0,
      comments: 0,
    } as YouTubeChannelSummary
  );

  return { summary, series };
}
