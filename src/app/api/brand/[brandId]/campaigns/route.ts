import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrandCampaigns, createBrandCampaign } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  return NextResponse.json(getBrandCampaigns(brandId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  return NextResponse.json(
    createBrandCampaign(brandId, { name: body.name, keywords: body.keywords || [], starts_at: body.starts_at, ends_at: body.ends_at }),
    { status: 201 },
  );
}
