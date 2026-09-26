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
import { evaluateMentionCrisis, insertMentionAlert } from '@/lib/mention-alerts';
import {
  buildMentionSyncResponse,
  conciseProviderError,
  syncQueriesForBrand,
  type ProviderOutcome,
} from '@/lib/mention-sync';
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
  brandName: string,
  platform: MentionPlatform,
  idPrefix: string,
  results: MentionSyncResult[],
): number {
  let inserted = 0;
  for (const r of results) {
    const { sentiment, emotion } = classifyMention(r.text);
    const isHighImpact = r.author_reach > 100_000;
    // Crisis heuristic: negative sentiment from a large account (>= 50k
    // reach); anything >= 100k reach is high-impact regardless of tone.
    const isCrisis = r.author_reach >= 50_000 && sentiment === 'negative';
    const fresh = insertBrandMention({
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
      is_crisis: isCrisis,
      is_high_impact: isHighImpact,
      published_at: r.published_at,
    });
    if (fresh) {
      inserted++;
      const kind = evaluateMentionCrisis({ author_reach: r.author_reach, sentiment, is_crisis: isCrisis, is_high_impact: isHighImpact });
      if (kind) {
        insertMentionAlert(kind, {
          brandName,
          platform,
          author_name: r.author_name,
          author_handle: r.author_handle,
          text: r.text,
          url: r.url || null,
          mentionId: `${idPrefix}_${r.id}`,
        });
      }
    }
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
  const brandName = brand.name;
  const queries = syncQueriesForBrand(brand.keywords, brandName);

  const skipped: string[] = [];
  const tasks: Promise<ProviderOutcome>[] = [];

  // Providers run concurrently (each has its own fetch timeout); queries
  // within a provider stay sequential to respect provider rate limits.
  // Every provider is independently best-effort: missing config or a
  // failed request only skips that provider, it never fails the whole sync.

  if (bearerToken) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        let inserted = 0;
        for (const query of queries) {
          const results = await searchXMentions({ bearerToken, query, maxResults: 50 });
          inserted += insertResults(brandId, brandName, 'x', 'x', results);
        }
        return { platform: 'x', inserted };
      } catch (err) {
        return { platform: 'x', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('x');
  }

  // Facebook's Graph API has no open keyword search across all of Facebook --
  // a Page access token only grants visibility into that Page's own posts
  // and comments, so this is scoped to searching the Page's recent posts.
  if (fbPageAccessToken && fbPageId) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        let inserted = 0;
        for (const query of queries) {
          const results = await searchFacebookPageMentions({
            pageAccessToken: fbPageAccessToken,
            pageId: fbPageId,
            query,
            maxResults: 50,
          });
          inserted += insertResults(brandId, brandName, 'facebook', 'facebook', results);
        }
        return { platform: 'facebook', inserted };
      } catch (err) {
        return { platform: 'facebook', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('facebook');
  }

  // Threads' public API only exposes mentions/replies on OUR OWN authorized
  // account -- it has no open, cross-platform keyword search like X's
  // search/recent endpoint, so `query`/brand.keywords are not used here.
  if (threadsAccessToken && threadsUserId) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        const results = await fetchThreadsMentions({
          accessToken: threadsAccessToken,
          threadsUserId,
          limit: 50,
        });
        return { platform: 'threads', inserted: insertResults(brandId, brandName, 'threads', 'threads', results) };
      } catch (err) {
        return { platform: 'threads', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('threads');
  }

  if (youtubeApiKey) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        let inserted = 0;
        for (const query of queries) {
          const results = await searchYouTubeMentions({ apiKey: youtubeApiKey, query, maxResults: 25 });
          inserted += insertResults(brandId, brandName, 'youtube', 'youtube', results);
        }
        return { platform: 'youtube', inserted };
      } catch (err) {
        return { platform: 'youtube', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('youtube');
  }

  if (igAccessToken && igBusinessAccountId) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        let inserted = 0;
        for (const query of queries) {
          const results = await searchInstagramMentions({
            accessToken: igAccessToken,
            businessAccountId: igBusinessAccountId,
            query,
            maxResults: 50,
          });
          inserted += insertResults(brandId, brandName, 'instagram', 'instagram', results);
        }
        return { platform: 'instagram', inserted };
      } catch (err) {
        return { platform: 'instagram', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('instagram');
  }

  if (tiktokAccessToken) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        let inserted = 0;
        for (const query of queries) {
          const results = await searchTikTokMentions({ accessToken: tiktokAccessToken, query, maxResults: 50 });
          inserted += insertResults(brandId, brandName, 'tiktok', 'tiktok', results);
        }
        return { platform: 'tiktok', inserted };
      } catch (err) {
        return { platform: 'tiktok', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('tiktok');
  }

  if (redditConfigured) {
    tasks.push((async (): Promise<ProviderOutcome> => {
      try {
        let inserted = 0;
        for (const query of queries) {
          const results = await searchRedditMentions({
            clientId: redditClientId as string,
            clientSecret: redditClientSecret as string,
            userAgent: redditUserAgent as string,
            query,
            maxResults: 50,
          });
          inserted += insertResults(brandId, brandName, 'reddit', 'reddit', results);
        }
        return { platform: 'reddit', inserted };
      } catch (err) {
        return { platform: 'reddit', error: conciseProviderError(err) };
      }
    })());
  } else {
    skipped.push('reddit');
  }

  const outcomes = await Promise.all(tasks);
  const { status, body } = buildMentionSyncResponse(outcomes, skipped, queries);
  return NextResponse.json(body, { status });
}
