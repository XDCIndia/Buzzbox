import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrandMentionStats } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const { searchParams } = req.nextUrl;
  const stats = getBrandMentionStats(brandId, {
    source_type: searchParams.get('source_type') || undefined,
    excludeSeed: searchParams.get('real') === 'true',
  });
  return NextResponse.json(stats);
}
