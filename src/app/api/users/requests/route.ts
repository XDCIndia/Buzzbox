import { NextResponse } from 'next/server';
import { listGoogleLoginRequests, requireAdmin, reviewGoogleLoginRequest } from '@/lib/auth';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Role = 'admin' | 'editor' | 'viewer';

function normalizeRole(value: unknown): Role | null {
  if (value === 'operator') return 'editor';
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value;
  return null;
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ requests: listGoogleLoginRequests() });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'unauthorized') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (msg === 'forbidden') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    return NextResponse.json({ error: 'Failed to load login requests' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    requireAdmin(request);
    const parsed = await parseAndValidate(
      request,
      z.object({
        email: z.string().min(1),
        action: z.enum(['approve', 'deny']),
        role: z.string().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    const role = normalizeRole(body.role) ?? 'viewer';
    reviewGoogleLoginRequest(email, body.action, role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'unauthorized') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (msg === 'forbidden') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    if (msg.includes('Email')) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: 'Failed to update login request' }, { status: 500 });
  }
}
