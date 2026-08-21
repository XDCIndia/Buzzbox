import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrand, updateBrand } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const brand = getBrand(brandId);
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  return NextResponse.json(brand);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const existing = getBrand(brandId);
  if (!existing) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const body = await req.json();
  updateBrand(brandId, { name: body.name, keywords: body.keywords, sources: body.sources });
  const brand = getBrand(brandId);
  return NextResponse.json(brand);
}
