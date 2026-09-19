import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { getHermesStateDir } from '@/lib/hermes-state';
import { requireApiUser } from '@/lib/api-auth';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

const STATE_DIR = getHermesStateDir();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;

  try {
    const instance = getInstance(getInstanceId(request));
    const { cronDir } = resolveOpenClawPaths(instance);

    const db = getDb();

    const sendingPausedPath = path.join(STATE_DIR, 'sending-paused.flag');
    const sending_paused = fs.existsSync(sendingPausedPath);

    let paused_reason: string | null = null;
    if (sending_paused) {
      try {
        paused_reason =
          fs.readFileSync(sendingPausedPath, 'utf-8').trim().split('\n')[0] || 'Paused';
      } catch {
        paused_reason = 'Paused';
      }
    }

    const content_pending = db
      .prepare("SELECT COUNT(*) as c FROM content_posts WHERE status = 'pending_approval'")
      .get() as { c: number };

    const seq_pending = db
      .prepare("SELECT COUNT(*) as c FROM sequences WHERE status = 'pending_approval'")
      .get() as { c: number };

    const stale_content = db
      .prepare(
        "SELECT COUNT(*) as c FROM content_posts WHERE status = 'pending_approval' AND created_at < datetime('now', '-24 hours')",
      )
      .get() as { c: number };

    const stale_sequences = db
      .prepare(
        "SELECT COUNT(*) as c FROM sequences WHERE status = 'pending_approval' AND created_at < datetime('now', '-24 hours')",
      )
      .get() as { c: number };

    let cron_total = 0;
    let cron_errors = 0;
    try {
      const jobsPath = path.join(cronDir, 'jobs.json');
      const raw = fs.readFileSync(jobsPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const jobs: unknown[] =
        Array.isArray(parsed)
          ? parsed
          : isRecord(parsed) && Array.isArray(parsed.jobs)
            ? (parsed.jobs as unknown[])
            : [];
      cron_total = jobs.length;
      cron_errors = jobs.filter((j) => {
        if (!isRecord(j)) return false;
        const enabled = j.enabled;
        if (enabled === false) return false;
        const state = j.state;
        if (!isRecord(state)) return false;
        const lastStatus = state.lastStatus;
        return typeof lastStatus === 'string' && lastStatus !== 'ok';
      }).length;
    } catch {
      // ignore
    }

    return NextResponse.json({
      instance: instance.id,
      sending_paused,
      paused_reason,
      approvals_pending: (content_pending?.c ?? 0) + (seq_pending?.c ?? 0),
      approvals_stale: (stale_content?.c ?? 0) + (stale_sequences?.c ?? 0),
      cron_total,
      cron_errors,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
