import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'hermes-session';
const PUBLIC_PATHS = ['/login', '/'];

/** Methods that never mutate state and are exempt from the CSRF origin check. */
const CSRF_EXEMPT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The Next dev server serves the app on both spellings of the loopback host
 * (localhost / 127.0.0.1) depending on which one the browser used, while
 * nextUrl.origin normalizes to localhost. Origin comparison must accept the
 * equivalent loopback spelling or every mutating request 403s (#86). */
function sameOrigin(a: string, b: string): boolean {
  if (a === b) return true;
  const normalize = (u: string) => {
    try {
      const url = new URL(u);
      const host = url.hostname;
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      return `${url.protocol}//${isLoopback ? 'loopback' : host}:${port}`;
    } catch {
      return u;
    }
  };
  return normalize(a) === normalize(b);
}

function startsWithOrigin(header: string, allowedOrigin: string): boolean {
  if (header.startsWith(allowedOrigin)) return true;
  try {
    const headerUrl = new URL(header);
    const allowedUrl = new URL(allowedOrigin);
    return sameOrigin(headerUrl.origin, allowedUrl.origin) && header.startsWith(headerUrl.origin);
  } catch {
    return false;
  }
}

function isHostAllowedByLock(hostName: string): boolean {
  const mode = (process.env.HERMES_HOST_LOCK || 'local').trim().toLowerCase();
  if (mode === 'off' || mode === 'disabled' || mode === 'false' || mode === '0') {
    return true;
  }

  if (mode === 'local') {
    const isLocalhost = hostName === 'localhost' || hostName === '127.0.0.1';
    const isTailscale = hostName.startsWith('100.') || hostName.endsWith('.ts.net');
    return isLocalhost || isTailscale;
  }

  // allowlist mode (comma-separated hostnames)
  const allowed = mode
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(hostName.toLowerCase());
}

export function proxy(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostName = host.split(':')[0];
  if (!isHostAllowedByLock(hostName)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  const apiKey = request.headers.get('x-api-key');

  if (!CSRF_EXEMPT_METHODS.has(request.method) && sessionToken && !(apiKey && apiKey === process.env.API_KEY)) {
    const allowedOrigin = process.env.PUBLIC_BASE_URL
      ? new URL(process.env.PUBLIC_BASE_URL).origin
      : request.nextUrl.origin;
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const originOk = origin ? sameOrigin(origin, allowedOrigin) : true;
    const refererOk = referer ? startsWithOrigin(referer, allowedOrigin) : true;
    if (!originOk || !refererOk || (!origin && !referer)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  if (pathname.startsWith('/api/')) {
    if (sessionToken || (apiKey && apiKey === process.env.API_KEY)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (sessionToken) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
