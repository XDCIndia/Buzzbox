import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getTopCreators } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const real = req.nextUrl.searchParams.get('real') === 'true';
  return NextResponse.json(getTopCreators(brandId, { excludeSeed: real }));
}
