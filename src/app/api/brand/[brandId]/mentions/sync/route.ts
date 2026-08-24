import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { getBrand, insertBrandMention } from '@/lib/brand-queries';
import { searchXMentions, type XMentionResult } from '@/lib/x-api';
import { searchFacebookPageMentions, type FacebookMentionResult } from '@/lib/facebook-api';
import { fetchThreadsMentions, type ThreadsMentionResult } from '@/lib/threads-api';
import { searchYouTubeMentions, type YouTubeMentionResult } from '@/lib/youtube-api';
import { searchInstagramMentions, type InstagramMentionResult } from '@/lib/instagram-api';
import { searchTikTokMentions, type TikTokMentionResult } from '@/lib/tiktok-api';
import { searchRedditMentions, type RedditMentionResult } from '@/lib/reddit-api';
import { classifyMention } from '@/lib/mention-classify';
import type { MentionPlatform } from '@/types';

type MentionSyncResult =
  | XMentionResult
  | FacebookMentionResult
  | ThreadsMentionResult
  | YouTubeMentionResult
  | InstagramMentionResult
  | TikTokMentionResult
  | RedditMentionResult;

function insertResults(
  brandId: string,
  platform: MentionPlatform,
  idPrefix: string,
  results: MentionSyncResult[],
): number {
  let inserted = 0;
  for (const r of results) {
    const { sentiment, emotion } = classifyMention(r.text);
    insertBrandMention({
      id: `${idPrefix}_${r.id}`,
      brand_id: brandId,
      source_type: 'social',
      platform,
      author_name: r.author_name,
      author_handle: r.author_handle,
      author_avatar_url: null,
      author_reach: r.author_reach,
      text: r.text,
      url: r.url || null,
      likes: r.likes,
      comments: r.comments,
      sentiment,
      emotion,
      intent: null,
      is_crisis: false,
      is_high_impact: r.author_reach > 100_000,
      published_at: r.published_at,
    });
    inserted++;
  }
  return inserted;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;

  const bearerToken = process.env.X_BEARER_TOKEN;
  const fbPageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const fbPageId = process.env.FACEBOOK_PAGE_ID;
  const threadsAccessToken = process.env.THREADS_ACCESS_TOKEN;
  const threadsUserId = process.env.THREADS_USER_ID;
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  const igAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igBusinessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const tiktokAccessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const redditClientId = process.env.REDDIT_CLIENT_ID;
  const redditClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const redditUserAgent = process.env.REDDIT_USER_AGENT;
  const redditConfigured = !!(redditClientId && redditClientSecret && redditUserAgent);

  if (
    !bearerToken &&
    !(fbPageAccessToken && fbPageId) &&
    !(threadsAccessToken && threadsUserId) &&
    !youtubeApiKey &&
    !(igAccessToken && igBusinessAccountId) &&
    !tiktokAccessToken &&
    !redditConfigured
  ) {
    return NextResponse.json(
      { error: 'No social connector is configured. Add X_BEARER_TOKEN, FACEBOOK_PAGE_ACCESS_TOKEN/FACEBOOK_PAGE_ID, THREADS_ACCESS_TOKEN/THREADS_USER_ID, YOUTUBE_API_KEY, INSTAGRAM_ACCESS_TOKEN/INSTAGRAM_BUSINESS_ACCOUNT_ID, TIKTOK_ACCESS_TOKEN, or REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET/REDDIT_USER_AGENT to .env.local to enable live mention syncing.' },
      { status: 412 },
    );
  }

  const brand = getBrand(brandId);
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const query = brand.keywords[0] || brand.name;

  let inserted = 0;
  const skipped: string[] = [];
  const errors: Record<string, string> = {};

  // Every platform below is independently best-effort: missing config or a
  // failed request only skips that platform, it never fails the whole sync.

  if (bearerToken) {
    try {
      const results = await searchXMentions({ bearerToken, query, maxResults: 50 });
      inserted += insertResults(brandId, 'x', 'x', results);
    } catch (err) {
      errors.x = (err as Error).message;
    }
  } else {
    skipped.push('x');
  }

  // Facebook's Graph API has no open keyword search across all of Facebook --
  // a Page access token only grants visibility into that Page's own posts
  // and comments, so this is scoped to searching the Page's recent posts.
  if (fbPageAccessToken && fbPageId) {
    try {
      const results = await searchFacebookPageMentions({
        pageAccessToken: fbPageAccessToken,
        pageId: fbPageId,
        query,
        maxResults: 50,
      });
      inserted += insertResults(brandId, 'facebook', 'facebook', results);
    } catch (err) {
      errors.facebook = (err as Error).message;
    }
  } else {
    skipped.push('facebook');
  }

  // Threads' public API only exposes mentions/replies on OUR OWN authorized
  // account -- it has no open, cross-platform keyword search like X's
  // search/recent endpoint, so `query`/brand.keywords are not used here.
  if (threadsAccessToken && threadsUserId) {
    try {
      const results = await fetchThreadsMentions({
        accessToken: threadsAccessToken,
        threadsUserId,
        limit: 50,
      });
      inserted += insertResults(brandId, 'threads', 'threads', results);
    } catch (err) {
      errors.threads = (err as Error).message;
    }
  } else {
    skipped.push('threads');
  }

  if (youtubeApiKey) {
    try {
      const results = await searchYouTubeMentions({ apiKey: youtubeApiKey, query, maxResults: 25 });
      inserted += insertResults(brandId, 'youtube', 'youtube', results);
    } catch (err) {
      errors.youtube = (err as Error).message;
    }
  } else {
    skipped.push('youtube');
  }

  if (igAccessToken && igBusinessAccountId) {
    try {
      const results = await searchInstagramMentions({
        accessToken: igAccessToken,
        businessAccountId: igBusinessAccountId,
        query,
        maxResults: 50,
      });
      inserted += insertResults(brandId, 'instagram', 'instagram', results);
    } catch (err) {
      errors.instagram = (err as Error).message;
    }
  } else {
    skipped.push('instagram');
  }

  if (tiktokAccessToken) {
    try {
      const results = await searchTikTokMentions({ accessToken: tiktokAccessToken, query, maxResults: 50 });
      inserted += insertResults(brandId, 'tiktok', 'tiktok', results);
    } catch (err) {
      errors.tiktok = (err as Error).message;
    }
  } else {
    skipped.push('tiktok');
  }

  if (redditConfigured) {
    try {
      const results = await searchRedditMentions({
        clientId: redditClientId as string,
        clientSecret: redditClientSecret as string,
        userAgent: redditUserAgent as string,
        query,
        maxResults: 50,
      });
      inserted += insertResults(brandId, 'reddit', 'reddit', results);
    } catch (err) {
      errors.reddit = (err as Error).message;
    }
  } else {
    skipped.push('reddit');
  }

  return NextResponse.json({ synced: inserted, skipped, ...(Object.keys(errors).length ? { errors } : {}) });
}
