import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrandDigests, createBrandDigest } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  return NextResponse.json(getBrandDigests(brandId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const real = req.nextUrl.searchParams.get('real') === 'true';
  return NextResponse.json(createBrandDigest(brandId, { excludeSeed: real }), { status: 201 });
}
