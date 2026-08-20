import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrand, insertBrandMention } from '@/lib/brand-queries';
import { searchXMentions } from '@/lib/x-api';
import { searchFacebookPageMentions } from '@/lib/facebook-api';
import { classifyMention } from '@/lib/mention-classify';

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;

  const bearerToken = process.env.X_BEARER_TOKEN;
  const fbPageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const fbPageId = process.env.FACEBOOK_PAGE_ID;

  if (!bearerToken && !(fbPageAccessToken && fbPageId)) {
    return NextResponse.json(
      { error: 'No platform is configured. Add X_BEARER_TOKEN, or FACEBOOK_PAGE_ACCESS_TOKEN + FACEBOOK_PAGE_ID, to .env.local to enable live mention syncing.' },
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

  if (fbPageAccessToken && fbPageId) {
    try {
      const results = await searchFacebookPageMentions({ pageAccessToken: fbPageAccessToken, pageId: fbPageId, query, maxResults: 50 });
      for (const r of results) {
        const { sentiment, emotion } = classifyMention(r.text);
        insertBrandMention({
          id: `facebook_${r.id}`,
          brand_id: brandId,
          source_type: 'social',
          platform: 'facebook',
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
      errors.facebook = (err as Error).message;
    }
  } else {
    skipped.push('facebook');
  }

  return NextResponse.json({ synced: inserted, skipped, ...(Object.keys(errors).length ? { errors } : {}) });
}
