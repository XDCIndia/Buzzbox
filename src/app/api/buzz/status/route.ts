import { NextResponse } from 'next/server';
import { isDicomputeConfigured } from '@/lib/dicompute';
import { requireApiAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Pre-flight capability check (#225): the Buzz modal calls this before it
 * invites the user to chat, so an unconfigured environment disables the
 * composer and explains the fix instead of letting a guaranteed failure
 * populate the transcript.
 *
 * Client-safe by construction: only a boolean crosses the wire -- never the
 * credential, its length, or the provider endpoint. Auth-guarded like the
 * Buzz POST route (the modal only renders in the admin dashboard).
 */
export async function GET(request: Request) {
  const auth = requireApiAdmin(request);
  if (auth) return auth;

  const response = NextResponse.json({
    ok: true,
    isAiConfigured: isDicomputeConfigured(),
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
