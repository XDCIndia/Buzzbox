import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { getBrand, insertBrandMention } from '@/lib/brand-queries';
import { searchXMentions } from '@/lib/x-api';
import { searchInstagramMentions } from '@/lib/instagram-api';
import { searchTikTokMentions } from '@/lib/tiktok-api';
import { searchRedditMentions } from '@/lib/reddit-api';
import { classifyMention } from '@/lib/mention-classify';

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;

  const bearerToken = process.env.X_BEARER_TOKEN;
  const tiktokAccessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const igAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igBusinessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const redditClientId = process.env.REDDIT_CLIENT_ID;
  const redditClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const redditUserAgent = process.env.REDDIT_USER_AGENT;
  const redditConfigured = !!(redditClientId && redditClientSecret && redditUserAgent);

  if (!bearerToken && !tiktokAccessToken && !(igAccessToken && igBusinessAccountId) && !redditConfigured) {
    return NextResponse.json(
      { error: 'No social connector is configured. Add X_BEARER_TOKEN, TIKTOK_ACCESS_TOKEN, INSTAGRAM_ACCESS_TOKEN/INSTAGRAM_BUSINESS_ACCOUNT_ID, or REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET/REDDIT_USER_AGENT to .env.local to enable live mention syncing.' },
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
      for (const r of results) {
        const { sentiment, emotion } = classifyMention(r.text);
        insertBrandMention({
          id: `x_${r.id}`,
          brand_id: brandId,
          source_type: 'social',
          platform: 'x',
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
    } catch (err) {
      errors.x = (err as Error).message;
    }
  } else {
    skipped.push('x');
  }

  if (!igAccessToken || !igBusinessAccountId) {
    skipped.push('instagram');
  } else {
    try {
      const results = await searchInstagramMentions({
        accessToken: igAccessToken,
        businessAccountId: igBusinessAccountId,
        query,
        maxResults: 50,
      });
      for (const r of results) {
        const { sentiment, emotion } = classifyMention(r.text);
        insertBrandMention({
          id: `instagram_${r.id}`,
          brand_id: brandId,
          source_type: 'social',
          platform: 'instagram',
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
    } catch (err) {
      errors.instagram = (err as Error).message;
    }
  }

  if (tiktokAccessToken) {
    try {
      const results = await searchTikTokMentions({ accessToken: tiktokAccessToken, query, maxResults: 50 });
      for (const r of results) {
        const { sentiment, emotion } = classifyMention(r.text);
        insertBrandMention({
          id: `tiktok_${r.id}`,
          brand_id: brandId,
          source_type: 'social',
          platform: 'tiktok',
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
      for (const r of results) {
        const { sentiment, emotion } = classifyMention(r.text);
        insertBrandMention({
          id: `reddit_${r.id}`,
          brand_id: brandId,
          source_type: 'social',
          platform: 'reddit',
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
    } catch (err) {
      errors.reddit = (err as Error).message;
    }
  } else {
    skipped.push('reddit');
  }

  return NextResponse.json({ synced: inserted, inserted, skipped, errors });
}
