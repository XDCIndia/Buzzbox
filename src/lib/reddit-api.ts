// Reddit mention search via Reddit's OAuth API.
//
// Reddit's "script" app type uses the OAuth2 client-credentials grant, which
// needs no user-facing consent flow (unlike Meta/TikTok's user-authorization
// flows) -- just a client id + secret registered at https://www.reddit.com/prefs/apps.
//
// Reddit requires a descriptive User-Agent on every request (including the
// token request) or it will throttle/block the caller with 429s.

export interface RedditMentionResult {
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

interface RedditTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface RedditPostData {
  id?: string;
  title?: string;
  selftext?: string;
  author?: string;
  permalink?: string;
  ups?: number | string;
  num_comments?: number | string;
  created_utc?: number | string;
  subreddit_subscribers?: number | string;
}

interface RedditListingChild {
  kind?: string;
  data?: RedditPostData;
}

interface RedditSearchResponse {
  data?: {
    children?: RedditListingChild[];
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// In-memory token cache -- refetched once expired (client-credentials tokens
// are typically valid for 1 hour). Not persisted across process restarts.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getRedditAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const basicAuth = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": opts.userAgent,
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit OAuth token request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as RedditTokenResponse;
  if (!data.access_token) {
    throw new Error("Reddit OAuth token response missing access_token");
  }

  const expiresInMs = (num(data.expires_in) || 3600) * 1000;
  cachedToken = {
    token: data.access_token,
    // refresh a little early so we never fire a request on the edge of expiry
    expiresAt: now + expiresInMs - 60_000,
  };

  return cachedToken.token;
}

/** Searches public Reddit posts matching `query` (e.g. a brand keyword) using a script-app (client-credentials) OAuth token. */
export async function searchRedditMentions(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  query: string;
  maxResults?: number;
}): Promise<RedditMentionResult[]> {
  const accessToken = await getRedditAccessToken(opts);

  const params = new URLSearchParams({
    q: opts.query,
    sort: "new",
    limit: String(Math.min(Math.max(opts.maxResults ?? 50, 1), 100)),
  });

  const res = await fetch(`https://oauth.reddit.com/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": opts.userAgent,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Reddit search failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as RedditSearchResponse;
  const children = json.data?.children ?? [];

  return children
    .filter((c): c is RedditListingChild & { data: RedditPostData } => c.kind === "t3" && !!c.data?.id)
    .map((c): RedditMentionResult => {
      const d = c.data;
      const text = [d.title, d.selftext].filter(Boolean).join("\n\n");
      return {
        id: d.id as string,
        text,
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : "",
        author_name: d.author ?? null,
        author_handle: d.author ?? null,
        // Reddit's search endpoint doesn't expose author karma; the
        // subreddit's subscriber count is the closest available reach proxy.
        author_reach: num(d.subreddit_subscribers),
        likes: num(d.ups),
        comments: num(d.num_comments),
        published_at:
          typeof d.created_utc === "number" || typeof d.created_utc === "string"
            ? new Date(num(d.created_utc) * 1000).toISOString()
            : null,
      };
    });
}
