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
    const alertsJson = path.join(healthDir, 'memory-alerts.json');

    if (!fs.existsSync(alertsJson)) {
      // Degrade gracefully like the sibling memory routes: no report yet is
      // a normal empty state, not an error — the page polls this endpoint
      // every minute, so a 404 here is permanent console/network spam (#177).
      return NextResponse.json({
        active: [],
        new: [],
        thresholds: { contradictions: 0, duplicates: 0, weak_agents: 0, never_ratio: 0 },
        configured: false,
      });
    }

    const raw = fs.readFileSync(alertsJson, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/memory-alerts error:', error);
    return NextResponse.json({ error: 'Failed to read memory alerts report' }, { status: 500 });
  }
}
