import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrandAlerts, createBrandAlert } from '@/lib/brand-queries';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

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
  const parsed = await parseAndValidate(
    req,
    z.object({
      name: z.string().min(1),
      filters: z.record(z.string(), z.unknown()).optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  return NextResponse.json(createBrandAlert(brandId, { name: body.name, filters: (body.filters || {}) as Record<string, string> }), { status: 201 });
}
