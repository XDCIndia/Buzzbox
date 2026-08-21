import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { requireApiCapability } from '@/lib/api-auth';
import { resolveCronRunFilePath } from '@/lib/cron-jobs';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

function getInstanceId(req: NextRequest): string | null {
  try {
    return req.nextUrl.searchParams.get('instance') || req.nextUrl.searchParams.get('namespace');
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = requireApiCapability(req as unknown as Request, 'manage_system');
  if (auth) return auth;

  try {
    const instance = getInstance(getInstanceId(req));
    const { cronDir } = resolveOpenClawPaths(instance);

    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const file = resolveCronRunFilePath(cronDir, id);
    if (!file) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    if (!fs.existsSync(file)) {
      return NextResponse.json({ runs: [] });
    }
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    const runs = lines
      .slice(-10)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return NextResponse.json({ instance: instance.id, runs });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

