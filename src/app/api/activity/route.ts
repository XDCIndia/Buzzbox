import { NextRequest, NextResponse } from 'next/server';
import { getActivityLog } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';
import { clampParam } from '@/lib/query-params';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const activity = getActivityLog({
    action: searchParams.get('action') || undefined,
    limit: clampParam(req, 'limit', 1, 500, 100),
    excludeSeed: real,
  });
  return NextResponse.json(activity);
}
