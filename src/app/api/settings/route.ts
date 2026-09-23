import { NextResponse } from 'next/server';
import { getDb, getDbPath } from '@/lib/db';
import { getSeedCount } from '@/lib/queries';
import { getSyncHealth } from '@/lib/sync';
import fs from 'node:fs';
import { requireApiUser } from '@/lib/api-auth';
const TABLE_NAMES = [
  'content_posts',
  'leads',
  'sequences',
  'suppression',
  'engagements',
  'signals',
  'experiments',
  'learnings',
  'daily_metrics',
  'activity_log',
  'notifications',
];

export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  try {
    const db = getDb();

    // Get DB file size
    let db_size_mb = 0;
    try {
      const stat = fs.statSync(getDbPath());
      db_size_mb = stat.size / (1024 * 1024);
    } catch {
      // file might not exist yet
    }

    // Get row counts for each table
    const tables = TABLE_NAMES.map((name) => {
      try {
        const row = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number };
        return { name, count: row?.c ?? 0 };
      } catch {
        return { name, count: 0 };
      }
    });

    const seed_count = getSeedCount();

    return NextResponse.json({
      db_size_mb,
      tables,
      last_sync: getSyncHealth().last_sync_at,
      sync_health: getSyncHealth(),
      seed_count,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get settings' }, { status: 500 });
  }
}

