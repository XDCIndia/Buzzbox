import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { deleteBrandDigest } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ brandId: string; digestId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, digestId } = await params;
  if (!deleteBrandDigest(brandId, digestId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
