import { fetchWithTimeout } from './fetch-with-timeout';

export interface LinkedInSummary {
  organizationUrn: string;
  followers?: number;
  impressions?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagementRatePct?: number;
}

export interface LinkedInSeriesPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
}

interface LinkedInShareElement {
  timeRange?: { start?: number };
  totalShareStatistics?: Record<string, unknown>;
  shareStatistics?: Record<string, unknown>;
  total?: Record<string, unknown>;
}

interface LinkedInFollowerStatsResponse {
  elements?: Array<Record<string, unknown>>;
}

interface LinkedInShareStatsResponse {
  totalShareStatistics?: Record<string, unknown>;
  elements?: LinkedInShareElement[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isLinkedInSeriesPoint(value: LinkedInSeriesPoint | null): value is LinkedInSeriesPoint {
  return value !== null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function liGet<T>(opts: {
  accessToken: string;
  url: string;
  version?: string;
}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
  };
  if (opts.version) headers["LinkedIn-Version"] = opts.version;

  const res = await fetchWithTimeout(opts.url, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LinkedIn API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function fetchLinkedInOrgAnalytics(opts: {
  accessToken: string;
  organizationUrn: string;
  version?: string;
}): Promise<{ summary: LinkedInSummary; series: LinkedInSeriesPoint[] }> {
  let followers: number | undefined;
  try {
    const followerStats = await liGet<LinkedInFollowerStatsResponse>({
      accessToken: opts.accessToken,
      version: opts.version,
      url:
        "https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?" +
        new URLSearchParams({
          q: "organizationalEntity",
          organizationalEntity: opts.organizationUrn,
        }).toString(),
    });

    const el = Array.isArray(followerStats?.elements) ? followerStats.elements[0] : null;
    const followerCounts = asRecord(el?.followerCounts);
    const fc =
      followerCounts.organicFollowerCount ??
      followerCounts.paidFollowerCount ??
      followerCounts.totalFollowerCount ??
      el?.followerCount;
    const parsed = num(fc);
    if (parsed > 0) followers = parsed;
  } catch {
    // ignore
  }

  const shareStats = await liGet<LinkedInShareStatsResponse>({
    accessToken: opts.accessToken,
    version: opts.version,
    url:
      "https://api.linkedin.com/rest/organizationalEntityShareStatistics?" +
      new URLSearchParams({
        q: "organizationalEntity",
        organizationalEntity: opts.organizationUrn,
      }).toString(),
  });

  const total = shareStats?.totalShareStatistics ?? shareStats?.elements?.[0]?.totalShareStatistics;
  const impressions = num(total?.impressionCount ?? total?.impressions);
  const clicks = num(total?.clickCount ?? total?.clicks);
  const likes = num(total?.likeCount ?? total?.likes);
  const comments = num(total?.commentCount ?? total?.comments);
  const shares = num(total?.shareCount ?? total?.shares);
  const engagementRatePct = impressions > 0 ? ((clicks + likes + comments + shares) / impressions) * 100 : 0;

  const series: LinkedInSeriesPoint[] = Array.isArray(shareStats?.elements)
    ? shareStats.elements
        .map((e) => {
          const startMs = e?.timeRange?.start as number | undefined;
          const date =
            typeof startMs === "number" && Number.isFinite(startMs)
              ? new Date(startMs).toISOString().slice(0, 10)
              : null;
          if (!date) return null;
          const stats = e?.totalShareStatistics ?? e?.shareStatistics ?? e?.total ?? {};
          return {
            date,
            impressions: num(stats?.impressionCount ?? stats?.impressions),
            clicks: num(stats?.clickCount ?? stats?.clicks),
            likes: num(stats?.likeCount ?? stats?.likes),
            comments: num(stats?.commentCount ?? stats?.comments),
            shares: num(stats?.shareCount ?? stats?.shares),
          };
        })
        .filter(isLinkedInSeriesPoint)
    : [];

  return {
    summary: {
      organizationUrn: opts.organizationUrn,
      followers,
      impressions,
      clicks,
      likes,
      comments,
      shares,
      engagementRatePct,
    },
    series,
  };
}
