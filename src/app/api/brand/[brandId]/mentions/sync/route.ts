import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrand, insertBrandMention } from '@/lib/brand-queries';
import { searchXMentions } from '@/lib/x-api';
import { searchInstagramMentions } from '@/lib/instagram-api';
import { classifyMention } from '@/lib/mention-classify';

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;

  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    return NextResponse.json(
      { error: 'X_BEARER_TOKEN is not configured. Add it to .env.local to enable live X mention syncing.' },
      { status: 412 },
    );
  }

  const brand = getBrand(brandId);
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const query = brand.keywords[0] || brand.name;

  let inserted = 0;
  const skipped: string[] = [];

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
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Instagram mention sync is independently best-effort: missing config or a
  // failed request only skips this platform, it never fails the whole sync.
  const igAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igBusinessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
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
    } catch {
      skipped.push('instagram');
    }
  }

  return NextResponse.json({ synced: inserted, inserted, skipped });
}
