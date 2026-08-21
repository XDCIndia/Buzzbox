import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { deleteBrandCampaign } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { campaignId } = await params;
  deleteBrandCampaign(campaignId);
  return NextResponse.json({ ok: true });
}
