import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { deleteBrandCampaign } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ brandId: string; campaignId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, campaignId } = await params;
  if (!deleteBrandCampaign(brandId, campaignId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
