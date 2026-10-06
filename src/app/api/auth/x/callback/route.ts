import { NextResponse } from 'next/server';
import { getUserFromRequest, safeDecodeURIComponent, safeRedirectPath } from '@/lib/auth';
import { X_ACCOUNT_TAKEN_CODE, upsertXConnection } from '@/lib/x-connections';
import {
  X_STATE_COOKIE,
  exchangeXAuthCode,
  fetchXOAuthUser,
  parseXStateCookie,
  statesMatch,
} from '@/lib/x-oauth';

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

function readCookie(request: Request, name: string): string | null {
  const rawCookie = request.headers.get('cookie') || '';
  const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? (safeDecodeURIComponent(match[1]) ?? null) : null;
}

function fail(origin: string, message: string, fallbackFrom = '/integrations'): NextResponse {
  const target = new URL(safeRedirectPath(fallbackFrom) || '/integrations', origin);
  target.searchParams.set('x_error', message);
  const res = NextResponse.redirect(target);
  res.cookies.set(X_STATE_COOKIE, '', { maxAge: 0, path: '/' });
  return res;
}

/**
 * GET /api/auth/x/callback — X redirects here after the user authorizes
 * (or denies) Buzzbox. Validates state, exchanges the code for tokens
 * (PKCE), fetches the X user, persists the connection, and redirects back
 * to the integrations page. Never puts tokens in URLs, logs, or responses.
 */
export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const origin = getPublicOrigin(request);
  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');
  const error = reqUrl.searchParams.get('error');

  const pending = parseXStateCookie(readCookie(request, X_STATE_COOKIE));
  const from = safeRedirectPath(pending?.from || '/integrations') || '/integrations';

  // User pressed "Cancel"/denied at X, or X returned an error.
  if (error) {
    const denied = error === 'access_denied' ? 'X authorization was cancelled' : `X authorization failed (${error})`;
    return fail(origin, denied, from);
  }

  if (!code) return fail(origin, 'Missing authorization code from X', from);
  if (!state || !pending || !statesMatch(pending.state, state)) {
    return fail(origin, 'X authorization state mismatch. Please try connecting again.', from);
  }

  const user = getUserFromRequest(request);
  if (!user || user.id === 0) {
    return fail(origin, 'Session expired. Log in and try connecting again.', from);
  }

  // User binding: the flow must complete as the user who started it. A
  // session switch mid-flow (logout/login as someone else) must not attach
  // the authorizing X account to the new session — fail closed instead.
  if (pending.userId !== user.id) {
    return fail(origin, 'X connection was started in a different session. Please start Connect X again.', from);
  }

  try {
    const tokens = await exchangeXAuthCode({ code, codeVerifier: pending.codeVerifier });
    const xUser = await fetchXOAuthUser(tokens.access_token);
    upsertXConnection(user.id, {
      xUserId: xUser.id,
      username: xUser.username,
      name: xUser.name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
      expiresIn: tokens.expires_in,
    });

    const target = new URL(from, origin);
    target.searchParams.set('x', 'connected');
    const res = NextResponse.redirect(target);
    res.cookies.set(X_STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return res;
  } catch (err) {
    // The taken-account message is a safe, secret-free application message
    // surfaced as-is; raw provider detail stays server-side (logged in lib).
    if ((err as { code?: string })?.code === X_ACCOUNT_TAKEN_CODE) {
      return fail(origin, (err as Error).message, from);
    }
    console.error('[x-oauth] Connect failed:', (err as Error).message);
    return fail(origin, 'Could not complete the X connection. Please try again.', from);
  }
}
