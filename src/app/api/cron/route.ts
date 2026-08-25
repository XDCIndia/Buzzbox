import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { allowCronWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';
import {
  mutateCronJobsFile,
  normalizeJobId,
  readCronJobsFile,
  toggleCronJob,
  triggerCronJobNow,
  type CronJobConfig,
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

    const data = JSON.parse(fsSync.readFileSync(jobsPath, 'utf-8'));
    const jobs = data.jobs || [];
    let notified = 0;

    for (const job of jobs) {
      if (!job.state?.lastRunAtMs) continue;
      const jobId = normalizeJobId(job.id ?? job.jobId);
      if (!jobId) continue;

      // Check if we already notified for this run
      const key = `cron:${instance.id}:${jobId}:${job.state.lastRunAtMs}`;
      const existing = db
        .prepare('SELECT 1 FROM notifications WHERE data LIKE ? LIMIT 1')
        .get(`%${key}%`);

      if (!existing) {
        const status = job.state.lastStatus === 'ok' ? 'info' : 'warning';
        const duration = job.state.lastDurationMs
          ? `${Math.round(job.state.lastDurationMs / 1000)}s`
          : '';
        const agentLabel = (job.agentId || 'unknown').charAt(0).toUpperCase() + (job.agentId || 'unknown').slice(1);

        db.prepare(`
          INSERT INTO notifications (type, severity, title, message, data)
          VALUES ('cron', ?, ?, ?, ?)
        `).run(
          status,
          `${agentLabel}: ${job.name} completed`,
          `${job.skill || jobId} finished in ${duration}. Status: ${job.state.lastStatus || 'unknown'}`,
          JSON.stringify({ key, job_id: jobId, agent_id: job.agentId, duration_ms: job.state.lastDurationMs }),
        );
        notified++;
      }
    }

    return NextResponse.json({ notified });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
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

    // Read cron jobs config
    const jobsFile = await readCronJobsFile(cronDir);
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
  const body = await request.json().catch(() => ({}));
  const id = normalizeJobId(body?.id ?? body?.jobId);
  const action = body?.action === 'toggle' || body?.action === 'trigger' ? body.action : null;

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
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
