import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { checkBrandAlert } from '@/lib/brand-queries';

export async function POST(req: NextRequest, { params }: { params: Promise<{ alertId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { alertId } = await params;
  return NextResponse.json(checkBrandAlert(alertId));
}
