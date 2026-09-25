import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { deleteBrandCompetitor } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ brandId: string; competitorId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, competitorId } = await params;
  if (!deleteBrandCompetitor(brandId, competitorId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
