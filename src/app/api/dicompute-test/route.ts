import { NextResponse, type NextRequest } from 'next/server';
import { askDicompute, MissingConfigError, UpstreamProviderError } from '@/lib/dicompute';
import { requireApiCapability } from '@/lib/api-auth';
import { getUserFromRequest } from '@/lib/auth';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  // Cost-bearing diagnostic with no UI callers: admin-only (#99). The edge
  // proxy authorizes /api/* on cookie presence alone, so every route must
  // re-validate -- an unguarded route is a public route.
  const auth = requireApiCapability(request as unknown as Request, 'manage_system');
  if (auth) return auth;

  // Manual diagnostic: cap calls per client IP so a stuck poller or curious
  // operator cannot burn LLM quota / hit upstream rate limits. Mirrors the
  // login brute-force protection (IP is header-aware behind a proxy).
  // The IP header alone is spoofable, so a per-user bucket backs it (#172).
  const ip = getClientIp(request as unknown as Request);
  const caller = getUserFromRequest(request as unknown as Request)?.username ?? 'unknown';
  const window = { max: 10, windowMs: 60_000 };
  const ipLimit = rateLimit(`dicompute-test:ip:${ip}`, window);
  const userLimit = rateLimit(`dicompute-test:user:${caller}`, window);
  const limit = !ipLimit.allowed || !userLimit.allowed
    ? { allowed: false, retryAfterMs: Math.max(ipLimit.retryAfterMs, userLimit.retryAfterMs) }
    : { allowed: true, retryAfterMs: 0 };
  if (!limit.allowed) {
    const retryAfterSec = Math.ceil(limit.retryAfterMs / 1000);
    return NextResponse.json(
      { success: false, error: 'Too many test requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  try {
    const result = await askDicompute([
      {
        role: 'system',
        content:
          'You are Buzz, the AI assistant for Buzzbox.',
      },
      {
        role: 'user',
        content:
          'Say hello and confirm that you are running successfully.',
      },
    ]);

    return NextResponse.json({
      success: true,
      response: result.content,
      model: result.model,
    });
  } catch (error) {
    // A missing connector credential is a configuration state, not a server
    // error -- answer 412 like POST /api/buzz does (#88).
    if (error instanceof MissingConfigError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 412 },
      );
    }

    // Upstream provider failures answer a concise, clean message -- the raw
    // response body was already logged server-side in dicompute.ts (#51).
    if (error instanceof UpstreamProviderError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 502 },
      );
    }

    console.error('DICOMPUTE test failed:', error);

    // Unknown failures answer a generic message: the raw error text can leak
    // provider/config internals to the client (#99).
    return NextResponse.json(
      { success: false, error: 'Dicompute test failed' },
      { status: 500 },
    );
  }
}