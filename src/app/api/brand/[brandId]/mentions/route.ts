import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrandMentions } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const platform = searchParams.getAll('platform');
  const sentiment = searchParams.getAll('sentiment');

  const mentions = getBrandMentions({
    brand_id: brandId,
    source_type: searchParams.get('source_type') || undefined,
    platform: platform.length ? platform : undefined,
    sentiment: sentiment.length ? sentiment : undefined,
    search: searchParams.get('search') || undefined,
    sort: (searchParams.get('sort') as 'newest' | 'oldest' | 'popular' | 'reach') || undefined,
    excludeSeed: real,
  });
  return NextResponse.json(mentions);
}
