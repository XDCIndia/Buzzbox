import { NextResponse } from 'next/server';
import { authenticate, createSession, destroySession, seedAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

const SESSION_COOKIE = 'hermes-session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function shouldUseSecureCookies(request: Request): boolean {
  const forced = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (forced === "true" || forced === "1" || forced === "yes") return true;
  if (forced === "false" || forced === "0" || forced === "no") return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

export async function POST(request: Request) {
  try {
    seedAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Auth configuration error' },
      { status: 500 },
    );
  }

  const parsed = await parseAndValidate(
    request,
    z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const { username, password } = parsed.data;

  // Brute-force protection: cap attempts per client IP and per username.
  // IP is header-aware because the standalone deployment sits behind a proxy.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const loginWindow = { max: 10, windowMs: 60_000 };
  const ipLimit = rateLimit(`login:ip:${ip}`, loginWindow);
  const userLimit = rateLimit(`login:user:${String(username).toLowerCase()}`, loginWindow);
  if (!ipLimit.allowed || !userLimit.allowed) {
    const retryAfterSec = Math.ceil(Math.max(ipLimit.retryAfterMs, userLimit.retryAfterMs) / 1000);
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  const user = authenticate(username, password);
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Invalidate any previously presented session token to reduce session fixation risk.
  const cookie = request.headers.get('cookie') || '';
  const existingMatch = cookie.match(/(?:^|;\s*)hermes-session=([^;]*)/);
  const existingToken = existingMatch ? decodeURIComponent(existingMatch[1]) : null;
  if (existingToken) {
    destroySession(existingToken);
  }

  const token = createSession(user.id);
  const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
  const secure = shouldUseSecureCookies(request);

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  response.headers.set('Cache-Control', 'no-store');

  return response;
}
