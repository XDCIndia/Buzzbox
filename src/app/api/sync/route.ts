import { NextResponse } from 'next/server';
import { startSync, syncAll } from '@/lib/sync';
import { requireApiCapability, requireApiUser } from '@/lib/api-auth';

// Start background sync on first import
let started = false;

export async function POST(request: Request) {
  const auth = requireApiCapability(request as Request, 'manage_system');
  if (auth) return auth;
  if (!started) {
    startSync();
    started = true;
  }
  syncAll();
  return NextResponse.json({ ok: true, synced_at: new Date().toISOString() });
}

export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  if (!started) {
    startSync();
    started = true;
  }
  return NextResponse.json({ ok: true, running: true });
}
