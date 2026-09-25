import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';
import { allowCronWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';
import {
  CronJobsCorruptError,
  mutateCronJobsFile,
  normalizeJobId,
  readCronJobsFile,
  toggleCronJob,
  triggerCronJobNow,
  type CronJobConfig,
  type CronJobsFile,
} from '@/lib/cron-jobs';

export const dynamic = 'force-dynamic';

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

/**
 * POST /api/cron — Check for completed cron jobs and create notifications
 */
export async function POST(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const instance = getInstance(getInstanceId(request));
    const { cronDir } = resolveOpenClawPaths(instance);

    const db = getDb();
    const jobsPath = path.join(cronDir, 'jobs.json');
    if (!fsSync.existsSync(jobsPath)) {
      return NextResponse.json({ notified: 0 });
    }

    let data: { jobs?: unknown };
    try {
      data = JSON.parse(fsSync.readFileSync(jobsPath, 'utf-8'));
    } catch {
      // Corrupt schedule: nothing to notify on, and the file is left alone
      // for the operator to reset via POST /api/cron/jobs/reset (#104).
      return NextResponse.json({ notified: 0, corrupt: true });
    }
    const jobs = ((data as { jobs?: unknown }).jobs as CronJobConfig[] | undefined) || [];
    let notified = 0;

    for (const job of jobs) {
      const state: Record<string, unknown> =
        typeof job.state === 'object' && job.state !== null
          ? (job.state as Record<string, unknown>)
          : {};
      const lastRunAtMs = state.lastRunAtMs;
      if (typeof lastRunAtMs !== 'number' || !lastRunAtMs) continue;
      const jobId = normalizeJobId(job.id ?? job.jobId);
      if (!jobId) continue;

      // Check if we already notified for this run
      const key = `cron:${instance.id}:${jobId}:${lastRunAtMs}`;
      const existing = db
        .prepare('SELECT 1 FROM notifications WHERE data LIKE ? LIMIT 1')
        .get(`%${key}%`);

      if (!existing) {
        const status = state.lastStatus === 'ok' ? 'info' : 'warning';
        const lastDurationMs = typeof state.lastDurationMs === 'number' ? state.lastDurationMs : 0;
        const duration = lastDurationMs ? `${Math.round(lastDurationMs / 1000)}s` : '';
        const agentLabel = (job.agentId || 'unknown').charAt(0).toUpperCase() + (job.agentId || 'unknown').slice(1);

        db.prepare(`
          INSERT INTO notifications (type, severity, title, message, data)
          VALUES ('cron', ?, ?, ?, ?)
        `).run(
          status,
          `${agentLabel}: ${job.name} completed`,
          `${job.skill || jobId} finished in ${duration}. Status: ${String(state.lastStatus || 'unknown')}`,
          JSON.stringify({ key, job_id: jobId, agent_id: job.agentId, duration_ms: lastDurationMs }),
        );
        notified++;
      }
    }

    return NextResponse.json({ notified });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const actor = requireUser(request);
    const instance = getInstance(getInstanceId(request));
    const { cronDir } = resolveOpenClawPaths(instance);
    const logsDir = path.join(cronDir, 'logs');

    // Read cron jobs config. A corrupt jobs.json surfaces as degraded state
    // (never a silent empty schedule); mutations refuse until it is reset.
    let jobsFile: CronJobsFile;
    try {
      jobsFile = await readCronJobsFile(cronDir);
    } catch (error) {
      if (error instanceof CronJobsCorruptError) {
        const isEditor = actor.role === 'admin' || actor.role === 'editor';
        return NextResponse.json({
          instance: instance.id,
          jobs: [],
          corrupt: true,
          error: 'Cron jobs file is corrupt. Quarantine or repair it (POST /api/cron/jobs/reset) before mutating schedules.',
          can_write: allowCronWrite() && isEditor,
          can_templates_write: isEditor,
        });
      }
      throw error;
    }
    const jobs = jobsFile.jobs as CronJobConfig[];

    // Read recent logs for each job
    const enriched = await Promise.all(
      jobs.map(async (job) => {
        try {
          const jobId = normalizeJobId(job.id ?? job.jobId);
          if (!jobId) return { ...job, lastRun: null, lastResult: null };
          const logFile = path.join(logsDir, `${jobId}.log`);
          const stat = await fs.stat(logFile).catch(() => null);
          if (!stat) return { ...job, lastRun: null, lastResult: null };

          // Read last 2KB of log
          const fd = await fs.open(logFile, 'r');
          const size = stat.size;
          const readSize = Math.min(size, 2048);
          const buffer = Buffer.alloc(readSize);
          await fd.read(buffer, 0, readSize, Math.max(0, size - readSize));
          await fd.close();

          const lastLines = buffer.toString('utf-8').trim().split('\n').slice(-5);
          return {
            ...job,
            lastRun: stat.mtime.toISOString(),
            lastResult: lastLines.join('\n'),
          };
        } catch {
          return { ...job, lastRun: null, lastResult: null };
        }
      }),
    );

    const isEditor = actor.role === 'admin' || actor.role === 'editor';
    const canWrite = allowCronWrite() && isEditor;
    return NextResponse.json({ instance: instance.id, jobs: enriched, can_write: canWrite, can_templates_write: isEditor });
  } catch (error) {
    console.error('GET /api/cron error:', error);
    return NextResponse.json({ error: 'Failed to read cron status' }, { status: 500 });
  }
}

/**
 * PUT /api/cron — Toggle or trigger an existing cron job.
 * Body: { id: string, action: "toggle" | "trigger" }
 */
export async function PUT(request: Request) {
  const auth = requireApiEditor(request);
  if (auth) return auth;
  if (!allowCronWrite()) {
    return NextResponse.json({ error: 'Cron writes are disabled (set HERMES_ALLOW_CRON_WRITE=true)' }, { status: 403 });
  }

  const actor = requireUser(request);
  const parsed = await parseAndValidate(
    request,
    z.object({
      id: z.string().optional(),
      jobId: z.string().optional(),
      action: z.enum(['toggle', 'trigger']),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const id = normalizeJobId(body?.id ?? body?.jobId);
  const action = body?.action ?? null;

  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  try {
    const instance = getInstance(getInstanceId(request));
    const { cronDir } = resolveOpenClawPaths(instance);
    const next = await mutateCronJobsFile(cronDir, (jobsFile) =>
    action === 'toggle'
    ? toggleCronJob(jobsFile, id)
    : triggerCronJobNow(jobsFile, id),
    );

  if (!next) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

    logAudit({
      actor,
      action: action === 'toggle' ? 'cron.toggle' : 'cron.trigger',
      target: `cron:${instance.id}:${id}`,
      detail: { instance: instance.id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CronJobsCorruptError) {
      return NextResponse.json(
        { error: 'Cron jobs file is corrupt. Quarantine or repair it (POST /api/cron/jobs/reset) before mutating schedules.' },
        { status: 409 },
      );
    }
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
