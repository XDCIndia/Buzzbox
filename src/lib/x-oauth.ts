import { createHash, randomBytes } from 'node:crypto';
import { fetchWithTimeout } from './fetch-with-timeout';

// X OAuth 2.0 Authorization Code flow with PKCE.
//
// Endpoints (X Developer Portal, OAuth 2.0 app type):
//   authorize: https://twitter.com/i/oauth2/authorize
//   token:     https://api.x.com/2/oauth2/token
//   user:      https://api.x.com/2/users/me
//
// Minimum scopes for Buzzbox's current X functionality (posting tweets,
// analytics incl. impressions, mention/search reads):
//   tweet.read tweet.write users.read offline.access
// No DM scopes are requested. offline.access yields a refresh token so the
// connection stays alive without repeated reconnects.

export const X_AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const X_USERINFO_URL = 'https://api.x.com/2/users/me';

/** Minimum scopes for Buzzbox's posting + analytics + mention reads. */
export const X_OAUTH_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] as const;

/** HTTP-only cookie holding the pending OAuth state + PKCE verifier. */
export const X_STATE_COOKIE = 'hermes-x-oauth-state';

export interface XOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function requireXOAuthEnv(): XOAuthEnv {
  const clientId = process.env.X_CLIENT_ID?.trim();
  const clientSecret = process.env.X_CLIENT_SECRET?.trim();
  const redirectUri = process.env.X_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'X OAuth is not configured. Set X_CLIENT_ID, X_CLIENT_SECRET, and X_REDIRECT_URI to enable Connect X.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** True when the app has enough config to offer Connect X. */
export function isXOAuthConfigured(): boolean {
  return Boolean(
    process.env.X_CLIENT_ID?.trim() &&
    process.env.X_CLIENT_SECRET?.trim() &&
    process.env.X_REDIRECT_URI?.trim(),
  );
}

/** PKCE code_verifier: 43-128 chars of unreserved characters (base64url of 32 bytes = 43 chars). */
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

/** PKCE S256 code_challenge for a verifier. */
export function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier, 'utf8').digest());
}

/** Opaque CSRF state token. */
export function generateState(): string {
  return randomBytes(24).toString('hex');
}

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildXAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', (opts.scopes ?? X_OAUTH_SCOPES).join(' '));
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

interface XTokenErrorBody {
  error?: string;
  error_description?: string;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

async function postTokenForm(body: URLSearchParams, env: XOAuthEnv): Promise<XTokenResponse> {
  const res = await fetchWithTimeout(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(env.clientId, env.clientSecret),
    },
    body: body.toString(),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as XTokenResponse & XTokenErrorBody;
  if (!res.ok) {
    // Provider-supplied detail stays server-side only (#51/#157): log a
    // truncated hint, throw a generic message with the status.
    const detail = json.error_description || json.error || '';
    console.error(`[x-oauth] Token upstream error ${res.status} detail (truncated):`, String(detail).slice(0, 500));
    const err = new Error(`X token exchange failed with status ${res.status}. Please try again later.`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = res.status;
    // invalid_grant covers expired codes, reused codes, and revoked refresh
    // tokens — callers use it to decide between retry and reconnect prompts.
    if (json.error === 'invalid_grant') err.code = 'invalid_grant';
    throw err;
  }
  if (!json.access_token) throw new Error('X token response missing access token');
  return json;
}

/** Step 2 of the flow: exchange the callback `code` (+ PKCE verifier) for tokens. */
export async function exchangeXAuthCode(opts: {
  code: string;
  codeVerifier: string;
  env?: XOAuthEnv;
}): Promise<XTokenResponse> {
  const env = opts.env ?? requireXOAuthEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: env.redirectUri,
    code_verifier: opts.codeVerifier,
    client_id: env.clientId,
  });
  return postTokenForm(body, env);
}

/** Refreshes an expiring access token using the stored refresh token (offline.access). */
export async function refreshXAccessToken(opts: {
  refreshToken: string;
  env?: XOAuthEnv;
}): Promise<XTokenResponse> {
  const env = opts.env ?? requireXOAuthEnv();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: env.clientId,
  });
  return postTokenForm(body, env);
}

export interface XOAuthUser {
  id: string;
  username: string;
  name: string | null;
}

interface XUserMeResponse {
  data?: { id?: string; username?: string; name?: string };
}

/** Fetches the authenticated X user's id/username (users.read) with the fresh access token. */
export async function fetchXOAuthUser(accessToken: string): Promise<XOAuthUser> {
  const url = `${X_USERINFO_URL}?user.fields=id,name,username`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[x-oauth] Userinfo upstream error ${res.status} body (truncated):`, text.slice(0, 500));
    throw new Error(`X user lookup failed with status ${res.status}. Please try again later.`);
  }
  const json = (await res.json()) as XUserMeResponse;
  if (!json.data?.id || !json.data?.username) throw new Error('X user lookup returned no user');
  return { id: json.data.id, username: json.data.username, name: json.data.name ?? null };
}

/** Mirrors the Google start/callback cookie policy: explicit override wins,
 * otherwise HTTPS (direct or x-forwarded-proto) requires Secure. */
export function shouldUseSecureCookies(request: Request): boolean {
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

export interface XStateCookie {
  state: string;
  codeVerifier: string;
  /** Buzzbox user id that started the flow — the callback must complete as the same user. */
  userId: number;
  from: string;
}

/**
 * Cookie value layout: `${state}:${verifier}:${userId}:${encodeURIComponent(from)}`.
 * state is hex, verifier is base64url, userId is digits — none contains ':',
 * and `from` is percent-encoded, so a 4-way split is unambiguous.
 * Pre-binding-format (3-part) cookies fail closed and must restart the flow.
 */
export function serializeXStateCookie(s: XStateCookie): string {
  return `${s.state}:${s.codeVerifier}:${s.userId}:${encodeURIComponent(s.from)}`;
}

export function parseXStateCookie(raw: string | null | undefined): XStateCookie | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length !== 4 || !parts[0] || !parts[1]) return null;
  const userId = Number(parts[2]);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  let from = '/';
  try {
    from = decodeURIComponent(parts[3]) || '/';
  } catch {
    return null;
  }
  return { state: parts[0], codeVerifier: parts[1], userId, from };
}

/** Timing-safe state comparison for the OAuth CSRF check. */
export function statesMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
