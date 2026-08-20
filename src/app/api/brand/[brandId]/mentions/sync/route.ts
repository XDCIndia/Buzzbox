import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrand, insertBrandMention } from '@/lib/brand-queries';
import { searchXMentions, type XMentionResult } from '@/lib/x-api';
import { fetchThreadsMentions, type ThreadsMentionResult } from '@/lib/threads-api';
import { classifyMention } from '@/lib/mention-classify';
import type { MentionPlatform } from '@/types';

function insertResults(
  brandId: string,
  platform: MentionPlatform,
  idPrefix: string,
  results: (XMentionResult | ThreadsMentionResult)[],
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
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;

  const brand = getBrand(brandId);
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const query = brand.keywords[0] || brand.name;

  const skipped: string[] = [];
  const errors: Record<string, string> = {};
  let inserted = 0;

  const xBearerToken = process.env.X_BEARER_TOKEN;
  if (xBearerToken) {
    try {
      const results = await searchXMentions({ bearerToken: xBearerToken, query, maxResults: 50 });
      inserted += insertResults(brandId, 'x', 'x', results);
    } catch (err) {
      errors.x = (err as Error).message;
    }
  } else {
    skipped.push('x');
  }

  // Threads' public API only exposes mentions/replies on OUR OWN authorized
  // account -- it has no open, cross-platform keyword search like X's
  // search/recent endpoint, so `query`/brand.keywords are not used here.
  const threadsAccessToken = process.env.THREADS_ACCESS_TOKEN;
  const threadsUserId = process.env.THREADS_USER_ID;
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

  return NextResponse.json({ synced: inserted, skipped, ...(Object.keys(errors).length ? { errors } : {}) });
}
