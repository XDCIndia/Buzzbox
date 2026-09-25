import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { checkBrandAlert } from '@/lib/brand-queries';

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandId: string; alertId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, alertId } = await params;
  const result = checkBrandAlert(brandId, alertId);
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(result);
}
