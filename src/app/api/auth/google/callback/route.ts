import { NextResponse } from 'next/server';
import { createSession, destroySession, recordGoogleLoginAttempt, upsertGoogleUser } from '@/lib/auth';

const STATE_COOKIE = 'hermes-google-state';
const SESSION_COOKIE = 'hermes-session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

function getPublicOrigin(request: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get('host');
  if (host) {
    const proto = new URL(request.url).protocol.replace(':', '');
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

function shouldUseSecureCookies(request: Request): boolean {
  const forced = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (forced === 'true' || forced === '1' || forced === 'yes') return true;
  if (forced === 'false' || forced === '0' || forced === 'no') return false;
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

function parseStateCookie(request: Request): { state: string; from: string } | null {
  const rawCookie = request.headers.get('cookie') || '';
  const match = rawCookie.match(/(?:^|;\s*)hermes-google-state=([^;]*)/);
  const value = match ? decodeURIComponent(match[1]) : '';
  if (!value) return null;
  const [state, encodedFrom] = value.split(':');
  if (!state) return null;
  const from = encodedFrom ? decodeURIComponent(encodedFrom) : '/';
  return { state, from: from.startsWith('/') ? from : '/' };
}

async function exchangeCodeForToken(code: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google SSO is not configured');
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Failed to exchange Google auth code');
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('Missing Google access token');
  }
  return payload.access_token;
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch Google user profile');
  }
  const payload = (await response.json()) as GoogleUserInfo;
  if (!payload.sub || !payload.email || !payload.email_verified) {
    throw new Error('Google account must have a verified email');
  }
  return payload;
}

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const origin = getPublicOrigin(request);
  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');
  const error = reqUrl.searchParams.get('error');

  if (error) {
    const fail = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent('Google sign-in cancelled')}`, origin));
    fail.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return fail;
  }

  const stateCookie = parseStateCookie(request);
  if (!code || !state || !stateCookie || stateCookie.state !== state) {
    const fail = NextResponse.redirect(new URL('/login?error=Google%20state%20mismatch', origin));
    fail.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return fail;
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const profile = await fetchGoogleUser(accessToken);
    let user;
    try {
      user = upsertGoogleUser(profile.sub, profile.email!);
    } catch (authErr) {
      const authMessage = (authErr as Error).message || 'Google login failed';
      if (
        authMessage.includes('not allowed')
        || authMessage.includes('pending')
        || authMessage.includes('denied')
      ) {
        recordGoogleLoginAttempt(profile.email!, profile.sub, authMessage);
      }
      throw authErr;
    }

    // Invalidate existing session token if present.
    const cookie = request.headers.get('cookie') || '';
    const existingMatch = cookie.match(/(?:^|;\s*)hermes-session=([^;]*)/);
    const existingToken = existingMatch ? decodeURIComponent(existingMatch[1]) : null;
    if (existingToken) destroySession(existingToken);

    const token = createSession(user.id);
    const response = NextResponse.redirect(new URL(stateCookie.from || '/dashboard', origin));
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: shouldUseSecureCookies(request),
      // OAuth callback comes from accounts.google.com (cross-site top-level navigation),
      // so Lax is required for the cookie to be sent on the next redirect.
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });
    response.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return response;
  } catch (err) {
    const message = (err as Error).message || 'Google login failed';
    const fail = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
    fail.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return fail;
  }
}
