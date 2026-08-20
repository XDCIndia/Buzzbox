import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  sla_stale_days: 7,
  sla_new_days: 3,
};

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;

  const sla_stale_days = Number(process.env.CRM_SLA_STALE_DAYS ?? DEFAULTS.sla_stale_days);
  const sla_new_days = Number(process.env.CRM_SLA_NEW_DAYS ?? DEFAULTS.sla_new_days);

  return NextResponse.json({ sla_stale_days, sla_new_days });
}
