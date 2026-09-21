import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrandCompetitors, createBrandCompetitor } from '@/lib/brand-queries';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  return NextResponse.json(getBrandCompetitors(brandId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const parsed = await parseAndValidate(req, z.object({ name: z.string().min(1) }));
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  return NextResponse.json(createBrandCompetitor(brandId, body.name), { status: 201 });
}
