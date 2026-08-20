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
    const healthJson = path.join(healthDir, 'memory-health.json');

    if (!fs.existsSync(healthJson)) {
      return NextResponse.json({
        namespace: instance.id,
        collected_at: new Date().toISOString(),
        collective: {
          shared_dir: healthDir,
          md_exists: false,
          jsonl_exists: false,
          md_mtime: null,
          jsonl_mtime: null,
          entries: 0,
        },
        agents: [],
      });
    }
    const raw = fs.readFileSync(healthJson, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (error) {
    console.error('GET /api/memory-health error:', error);
    return NextResponse.json({ error: 'Failed to read memory health report' }, { status: 500 });
  }
}
