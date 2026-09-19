import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { allowCronWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';
import {
  deleteCronJob,
  normalizeJobId,
  readCronJobsFile,
  upsertCronJob,
  writeCronJobsFile,
  type CronJobConfig,
} from '@/lib/cron-jobs';

export const dynamic = 'force-dynamic';

function stripDerivedFields(job: CronJobConfig): CronJobConfig {
  const out = { ...(job as Record<string, unknown>) };
  delete out.lastRun;
  delete out.lastResult;
  return out as CronJobConfig;
}

function getInstanceId(req: NextRequest): string | null {
  try {
    return req.nextUrl.searchParams.get('instance') || req.nextUrl.searchParams.get('namespace');
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;
  try {
    const actor = requireUser(req as unknown as Request);
    const instance = getInstance(getInstanceId(req));
    const { cronDir } = resolveOpenClawPaths(instance);
    const jobsFile = await readCronJobsFile(cronDir);
    const canWrite = allowCronWrite() && (actor.role === 'admin' || actor.role === 'editor');
    return NextResponse.json({ instance: instance.id, jobs: jobsFile.jobs, can_write: canWrite });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowCronWrite()) {
    return NextResponse.json({ error: 'Cron writes are disabled (set HERMES_ALLOW_CRON_WRITE=true)' }, { status: 403 });
  }
  const actor = requireUser(req as unknown as Request);
  const body = await req.json().catch(() => ({}));

  const rawJob = body?.job as CronJobConfig | undefined;
  const job = rawJob ? stripDerivedFields(rawJob) : undefined;
  const id = normalizeJobId(job?.id ?? job?.jobId);
  if (!id) return NextResponse.json({ error: 'Invalid job.id' }, { status: 400 });

  try {
    const instance = getInstance(getInstanceId(req));
    const { cronDir } = resolveOpenClawPaths(instance);
    const jobsFile = await readCronJobsFile(cronDir);
    if (jobsFile.jobs.some((j) => normalizeJobId(j.id ?? j.jobId) === id)) {
      return NextResponse.json({ error: 'Job already exists' }, { status: 409 });
    }
    const next = upsertCronJob(jobsFile, { ...(job || {}), id, jobId: id });
    await writeCronJobsFile(cronDir, next);

    logAudit({
      actor,
      action: 'cron.create',
      target: `cron:${instance.id}:${id}`,
      detail: { instance: instance.id },
    });

    return NextResponse.json({ ok: true, jobs: next.jobs });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowCronWrite()) {
    return NextResponse.json({ error: 'Cron writes are disabled (set HERMES_ALLOW_CRON_WRITE=true)' }, { status: 403 });
  }
  const actor = requireUser(req as unknown as Request);
  const body = await req.json().catch(() => ({}));

  const rawJob = body?.job as CronJobConfig | undefined;
  const job = rawJob ? stripDerivedFields(rawJob) : undefined;
  const id = normalizeJobId(job?.id ?? job?.jobId);
  if (!id) return NextResponse.json({ error: 'Invalid job.id' }, { status: 400 });

  try {
    const instance = getInstance(getInstanceId(req));
    const { cronDir } = resolveOpenClawPaths(instance);
    const jobsFile = await readCronJobsFile(cronDir);
    if (!jobsFile.jobs.some((j) => normalizeJobId(j.id ?? j.jobId) === id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const next = upsertCronJob(jobsFile, { ...(job || {}), id, jobId: id });
    await writeCronJobsFile(cronDir, next);

    logAudit({
      actor,
      action: 'cron.update',
      target: `cron:${instance.id}:${id}`,
      detail: { instance: instance.id },
    });

    return NextResponse.json({ ok: true, jobs: next.jobs });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowCronWrite()) {
    return NextResponse.json({ error: 'Cron writes are disabled (set HERMES_ALLOW_CRON_WRITE=true)' }, { status: 403 });
  }
  const actor = requireUser(req as unknown as Request);

  const id = normalizeJobId(req.nextUrl.searchParams.get('id') || req.nextUrl.searchParams.get('jobId'));
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const instance = getInstance(getInstanceId(req));
    const { cronDir } = resolveOpenClawPaths(instance);
    const jobsFile = await readCronJobsFile(cronDir);
    if (!jobsFile.jobs.some((j) => normalizeJobId(j.id ?? j.jobId) === id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const next = deleteCronJob(jobsFile, id);
    await writeCronJobsFile(cronDir, next);

    logAudit({
      actor,
      action: 'cron.delete',
      target: `cron:${instance.id}:${id}`,
      detail: { instance: instance.id },
    });

    return NextResponse.json({ ok: true, jobs: next.jobs });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
