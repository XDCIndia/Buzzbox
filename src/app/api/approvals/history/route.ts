import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, ts, action, detail, result
       FROM activity_log
       WHERE action IN ('approve', 'reject')
       ORDER BY ts DESC
       LIMIT 50`
    ).all();

    return NextResponse.json({ history: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
