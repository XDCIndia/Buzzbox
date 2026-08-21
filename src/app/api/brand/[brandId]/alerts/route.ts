import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrandAlerts, createBrandAlert } from '@/lib/brand-queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  return NextResponse.json(getBrandAlerts(brandId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  return NextResponse.json(createBrandAlert(brandId, { name: body.name, filters: body.filters || {} }), { status: 201 });
}
