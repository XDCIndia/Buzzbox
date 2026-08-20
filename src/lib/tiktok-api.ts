// TikTok integration.
//
// IMPORTANT ACCESS-TIER NOTE:
// TikTok has no open public keyword-search API comparable to X for an
// unapproved app. There are exactly two real options:
//
//   (a) TikTok Display API (Login Kit / "content posting & data" scopes) —
//       only returns the OWN authorized account's videos + analytics, never
//       brand-keyword mentions made by other accounts across TikTok. This is
//       what `fetchOwnVideos` / `fetchOwnVideoAnalytics` below use, and it is
//       reachable by any registered TikTok developer app.
//
//   (b) TikTok Research API — does support broader keyword/hashtag video
//       search, but requires a separate, strict, approved-researcher access
//       tier that most teams (and this app, by default) do not have.
//       `searchTikTokMentions` below is shaped against that endpoint, but
//       throws a descriptive error rather than returning an empty array when
//       the configured token/app is not on that tier, so callers (e.g. the
//       mention-sync route) can surface a clear message instead of silently
//       reporting zero mentions.
//
// In short: this module can authenticate and pull analytics for the brand's
// own TikTok account, but it CANNOT search TikTok-wide for brand mentions
// unless/until Research API access is granted.

const TIKTOK_OAUTH_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const TIKTOK_VIDEO_QUERY_URL = 'https://open.tiktokapis.com/v2/video/query/';
const TIKTOK_RESEARCH_VIDEO_QUERY_URL = 'https://open.tiktokapis.com/v2/research/video/query/';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// ─── OAuth2 (authorization-code + refresh-token flow, per TikTok Login Kit) ───

export interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
}

interface TikTokOAuthErrorBody {
  error?: string;
  error_description?: string;
  message?: string;
}

async function postForm(url: string, body: Record<string, string>): Promise<TikTokTokenResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as TikTokTokenResponse & TikTokOAuthErrorBody;
  if (!res.ok || json.error) {
    const detail = json.error_description || json.message || json.error || (await res.text().catch(() => ''));
    throw new Error(`TikTok OAuth failed (${res.status}): ${detail}`.slice(0, 400));
  }
  return json;
}

/** Step 2 of the authorization-code flow: exchanges the redirect `code` for an access + refresh token. */
export async function exchangeTikTokAuthCode(opts: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TikTokTokenResponse> {
  return postForm(TIKTOK_OAUTH_TOKEN_URL, {
    client_key: opts.clientKey,
    client_secret: opts.clientSecret,
    code: opts.code,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
  });
}

/** Refreshes an expired/expiring access token using the long-lived refresh token. */
export async function refreshTikTokToken(opts: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TikTokTokenResponse> {
  return postForm(TIKTOK_OAUTH_TOKEN_URL, {
    client_key: opts.clientKey,
    client_secret: opts.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
  });
}

// ─── Display API: owned-account videos + analytics ────────────────────────

export interface TikTokOwnVideo {
  id: string;
  text: string;
  url: string;
  author_name: string | null;
  author_handle: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  published_at: string | null;
}

interface TikTokVideoListItem {
  id?: string;
  video_description?: string;
  title?: string;
  share_url?: string;
  create_time?: number; // unix seconds
  like_count?: number | string;
  comment_count?: number | string;
  share_count?: number | string;
  view_count?: number | string;
}

interface TikTokVideoListResponse {
  data?: {
    videos?: TikTokVideoListItem[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string; log_id?: string };
}

async function tiktokGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!res.ok || (json as { error?: { code?: string } }).error?.code) {
    const err = (json as { error?: { code?: string; message?: string } }).error;
    throw new Error(`TikTok API failed (${res.status}): ${err?.code || ''} ${err?.message || ''}`.trim().slice(0, 400));
  }
  return json;
}

/**
 * Lists videos from the OWN authorized account (Display API — `video.list` scope).
 * This is NOT a brand-mention search: TikTok's public API does not expose other
 * accounts' videos by keyword for apps without Research API access.
 */
export async function fetchOwnTikTokVideos(opts: {
  accessToken: string;
  handle?: string | null;
  maxResults?: number;
}): Promise<TikTokOwnVideo[]> {
  const fields = [
    'id',
    'video_description',
    'title',
    'share_url',
    'create_time',
    'like_count',
    'comment_count',
    'share_count',
    'view_count',
  ].join(',');
  const maxCount = Math.min(Math.max(opts.maxResults ?? 20, 1), 20);
  const params = new URLSearchParams({ fields, max_count: String(maxCount) });

  const res = await tiktokGet<TikTokVideoListResponse>(
    `${TIKTOK_VIDEO_LIST_URL}?${params.toString()}`,
    opts.accessToken
  );

  const videos = res.data?.videos ?? [];
  return videos.map((v): TikTokOwnVideo => ({
    id: v.id || crypto.randomUUID(),
    text: v.video_description || v.title || '',
    url: v.share_url || '',
    author_name: null,
    author_handle: opts.handle ?? null,
    likes: num(v.like_count),
    comments: num(v.comment_count),
    shares: num(v.share_count),
    views: num(v.view_count),
    published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
  }));
}

/** Aggregated analytics for the own account's recent videos (sums over the fetched page). */
export async function fetchOwnTikTokAnalytics(opts: {
  accessToken: string;
  handle?: string | null;
}): Promise<{ videos: number; likes: number; comments: number; shares: number; views: number }> {
  const videos = await fetchOwnTikTokVideos({ accessToken: opts.accessToken, handle: opts.handle, maxResults: 20 });
  return videos.reduce(
    (acc, v) => {
      acc.videos += 1;
      acc.likes += v.likes;
      acc.comments += v.comments;
      acc.shares += v.shares;
      acc.views += v.views;
      return acc;
    },
    { videos: 0, likes: 0, comments: 0, shares: 0, views: 0 }
  );
}

// ─── Research API: brand-keyword mention search (requires special access tier) ───

export interface TikTokMentionResult {
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

interface TikTokResearchVideo {
  id?: string | number;
  video_description?: string;
  username?: string;
  create_time?: number;
  like_count?: number | string;
  comment_count?: number | string;
  share_count?: number | string;
  view_count?: number | string;
}

interface TikTokResearchQueryResponse {
  data?: { videos?: TikTokResearchVideo[]; cursor?: number; has_more?: boolean };
  error?: { code?: string; message?: string; log_id?: string };
}

/**
 * Searches TikTok-wide for videos matching a keyword/hashtag via the
 * Research API (`/v2/research/video/query/`).
 *
 * This endpoint is NOT reachable by a typical app: it requires TikTok's
 * separate, strict, approved-researcher access tier. If the configured
 * TIKTOK_ACCESS_TOKEN is not on that tier (the overwhelmingly common case),
 * TikTok responds with an auth/permission error, and this function throws a
 * descriptive Error rather than returning an empty array — callers must not
 * treat a thrown error here as "zero mentions found".
 */
export async function searchTikTokMentions(opts: {
  accessToken: string;
  query: string;
  maxResults?: number;
}): Promise<TikTokMentionResult[]> {
  const maxCount = Math.min(Math.max(opts.maxResults ?? 50, 10), 100);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startDate = oneWeekAgo.toISOString().slice(0, 10).replace(/-/g, '');
  const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const res = await fetch(
    `${TIKTOK_RESEARCH_VIDEO_QUERY_URL}?fields=id,video_description,username,create_time,like_count,comment_count,share_count,view_count`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          and: [{ operation: 'IN', field_name: 'keyword', field_values: [opts.query] }],
        },
        start_date: startDate,
        end_date: endDate,
        max_count: maxCount,
      }),
      cache: 'no-store',
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'TikTok mention search requires Research API access — the configured TikTok token/app is not on that approved tier. ' +
      'Use fetchOwnTikTokVideos()/fetchOwnTikTokAnalytics() for the owned-account Display API instead.'
    );
  }

  const json = (await res.json().catch(() => ({}))) as TikTokResearchQueryResponse;
  if (!res.ok || json.error) {
    const msg = json.error?.message || '';
    if (/scope|permission|research|access/i.test(msg)) {
      throw new Error(
        `TikTok mention search requires Research API access — TikTok rejected the request: ${msg}`.slice(0, 400)
      );
    }
    throw new Error(`TikTok Research API failed (${res.status}): ${msg}`.slice(0, 400));
  }

  const videos = json.data?.videos ?? [];
  return videos.map((v): TikTokMentionResult => {
    const id = String(v.id ?? crypto.randomUUID());
    const handle = v.username ?? null;
    return {
      id,
      text: v.video_description || '',
      url: handle ? `https://www.tiktok.com/@${handle}/video/${id}` : '',
      author_name: null,
      author_handle: handle,
      author_reach: 0,
      likes: num(v.like_count),
      comments: num(v.comment_count),
      published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
    };
  });
}

// Referenced for parity with the Display API's alternate query endpoint name;
// kept as an export in case callers need the raw URL for diagnostics/logging.
export const TIKTOK_ENDPOINTS = {
  oauthToken: TIKTOK_OAUTH_TOKEN_URL,
  videoList: TIKTOK_VIDEO_LIST_URL,
  videoQuery: TIKTOK_VIDEO_QUERY_URL,
  researchVideoQuery: TIKTOK_RESEARCH_VIDEO_QUERY_URL,
};
