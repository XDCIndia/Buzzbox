import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrand, insertBrandMention } from '@/lib/brand-queries';
import { searchXMentions } from '@/lib/x-api';
import { searchRedditMentions } from '@/lib/reddit-api';
import { classifyMention } from '@/lib/mention-classify';

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;

  const bearerToken = process.env.X_BEARER_TOKEN;
  const redditClientId = process.env.REDDIT_CLIENT_ID;
  const redditClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const redditUserAgent = process.env.REDDIT_USER_AGENT;
  const redditConfigured = !!(redditClientId && redditClientSecret && redditUserAgent);

  if (!bearerToken && !redditConfigured) {
    return NextResponse.json(
      { error: 'No social platform is configured. Add X_BEARER_TOKEN or REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET/REDDIT_USER_AGENT to .env.local to enable live mention syncing.' },
      { status: 412 },
    );
  }

  const brand = getBrand(brandId);
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const query = brand.keywords[0] || brand.name;

  let inserted = 0;
  const skipped: string[] = [];
  const errors: Record<string, string> = {};

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

  return NextResponse.json({ synced: inserted, skipped, ...(Object.keys(errors).length ? { errors } : {}) });
}
