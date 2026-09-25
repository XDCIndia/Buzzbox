import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { deleteBrandAlert } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ brandId: string; alertId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, alertId } = await params;
  if (!deleteBrandAlert(brandId, alertId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
