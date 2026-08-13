import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { deleteBrandAlert } from '@/lib/brand-queries';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ alertId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { alertId } = await params;
  deleteBrandAlert(alertId);
  return NextResponse.json({ ok: true });
}
