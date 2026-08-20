import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireApiUser } from '@/lib/api-auth';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

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
    const { healthDir } = resolveOpenClawPaths(instance);
    const driftJson = path.join(healthDir, 'memory-drift-weekly.json');

    if (!fs.existsSync(driftJson)) {
      return NextResponse.json({
        namespace: instance.id,
        collected_at: new Date().toISOString(),
        window_days: 7,
        collective_total: 0,
        contradictions: {
          count: 0,
          top_events: [],
          by_agent: {},
        },
        duplicates: {
          count: 0,
          top_clusters: [],
        },
        access: {
          hot_count: 0,
          cold_count: 0,
          never_accessed_count: 0,
          total: 0,
          top_accessed: [],
        },
        contributions: {
          agents: [],
          weak_agents: [],
          weak_ratio_threshold: 0.2,
          weak_min_sessions: 5,
        },
      });
    }
    const raw = fs.readFileSync(driftJson, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/memory-drift error:', error);
    return NextResponse.json({ error: 'Failed to read memory drift report' }, { status: 500 });
  }
}
