import { NextResponse } from 'next/server';
import { getUserFromRequest, safeRedirectPath } from '@/lib/auth';
import {
  X_STATE_COOKIE,
  buildXAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  requireXOAuthEnv,
  serializeXStateCookie,
  shouldUseSecureCookies,
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

/**
 * GET /api/auth/x/start — begins the X OAuth 2.0 (PKCE) connect flow.
 * Requires a Buzzbox session (the connection is stored per-user). Generates
 * state + PKCE verifier/challenge, stashes state+verifier in a short-lived
 * HTTP-only cookie, and redirects the browser to X's authorization endpoint.
 */
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const user = getUserFromRequest(request);
  if (!user || user.id === 0) {
    return NextResponse.redirect(new URL('/login?error=X%20connect%20requires%20login', origin));
  }

  let env: { clientId: string; redirectUri: string };
  try {
    env = requireXOAuthEnv();
  } catch (error) {
    return NextResponse.redirect(
      new URL(`/integrations?x_error=${encodeURIComponent((error as Error).message)}`, origin),
    );
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const from = safeRedirectPath(new URL(request.url).searchParams.get('from') || '/integrations');

  const authUrl = buildXAuthorizeUrl({
    clientId: env.clientId,
    redirectUri: env.redirectUri,
    state,
    codeChallenge,
  });

  const response = NextResponse.redirect(authUrl);
  // Bind the initiating user into the state cookie so a session switch
  // mid-flow cannot attach this X account to a different Buzzbox user.
  response.cookies.set(X_STATE_COOKIE, serializeXStateCookie({ state, codeVerifier, userId: user.id, from }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    maxAge: 10 * 60,
    path: '/',
  });
  return response;
}
