import { NextRequest, NextResponse } from 'next/server';
import { getDailyMetrics, getWeeklyKPIs } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';
import { clampParam } from '@/lib/query-params';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const weeks = clampParam(req, 'weeks', 1, 52, 12);
  const real = searchParams.get('real') === 'true';

  const daily = getDailyMetrics(weeks * 7, { excludeSeed: real });
  const weekly = getWeeklyKPIs(weeks, { excludeSeed: real });

  return NextResponse.json({ daily, weekly });
}
