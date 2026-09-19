import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getBrand, updateBrand } from '@/lib/brand-queries';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

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
  // Trim, drop empties, and bound the list sizes before they reach the DB.
  const tagList = z
    .array(z.string().max(120))
    .max(100, 'Too many items (max 100)')
    .transform(arr => arr.map(s => s.trim()).filter(Boolean));
  const parsed = await parseAndValidate(
    req,
    z.object({
      name: z.string().max(120).nullable().optional(),
      keywords: tagList.nullable().optional(),
      sources: tagList.nullable().optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  updateBrand(brandId, { name: body.name ?? undefined, keywords: body.keywords ?? undefined, sources: body.sources ?? undefined });
  const brand = getBrand(brandId);
  return NextResponse.json(brand);
}
