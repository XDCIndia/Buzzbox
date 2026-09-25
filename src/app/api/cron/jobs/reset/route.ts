import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { allowCronWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';
import { resetCorruptJobsFile } from '@/lib/cron-jobs';

export const dynamic = 'force-dynamic';

function getInstanceId(req: NextRequest): string | null {
  try {
    return req.nextUrl.searchParams.get('instance') || req.nextUrl.searchParams.get('namespace');
  } catch {
    return null;
  }
}

/**
 * POST /api/cron/jobs/reset — Quarantine a corrupt jobs.json
 * (`jobs.json.corrupt.<timestamp>.<rand>`, never pruned) and write a fresh
 * empty schedule. Only acts when the file is actually corrupt or
 * non-object; a missing file or a valid schedule answers 409 so this
 * endpoint can never surprise-wipe schedules (#104).
 */
export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowCronWrite()) {
    return NextResponse.json({ error: 'Cron writes are disabled (set HERMES_ALLOW_CRON_WRITE=true)' }, { status: 403 });
  }
  const actor = requireUser(req as unknown as Request);

  try {
    const instance = getInstance(getInstanceId(req));
    const { cronDir } = resolveOpenClawPaths(instance);
    const result = await resetCorruptJobsFile(cronDir);
    if (!result) {
      return NextResponse.json({ error: 'Jobs file is not corrupt; nothing to reset' }, { status: 409 });
    }

    logAudit({
      actor,
      action: 'cron.reset-corrupt',
      target: `cron:${instance.id}`,
      detail: { instance: instance.id, quarantined: result.quarantined },
    });

    return NextResponse.json({ ok: true, quarantined: result.quarantined });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
