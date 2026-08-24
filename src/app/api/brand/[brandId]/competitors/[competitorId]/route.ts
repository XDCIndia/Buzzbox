import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { deleteBrandCompetitor } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ competitorId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { competitorId } = await params;
  deleteBrandCompetitor(competitorId);
  return NextResponse.json({ ok: true });
}
