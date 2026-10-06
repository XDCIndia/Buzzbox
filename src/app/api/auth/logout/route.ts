import { NextResponse } from 'next/server';
import { destroySession, safeDecodeURIComponent } from '@/lib/auth';

const SESSION_COOKIE = 'hermes-session';

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
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)hermes-session=([^;]*)/);
  const token = match ? safeDecodeURIComponent(match[1]) : null;

  if (token) destroySession(token);

  const response = NextResponse.json({ ok: true });
  const secure = shouldUseSecureCookies(request);
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure,
    // Matches the login cookie attributes.
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
