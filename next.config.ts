import path from 'path';
import type { NextConfig } from 'next';

// Optional extra origins for the Next.js dev server's /_next/* + HMR
// cross-origin protection (comma-separated, no scheme). This is NOT the
// gate for page/API routes -- that is HERMES_HOST_LOCK in src/proxy.ts.
// Leave HERMES_DEV_ORIGINS unset unless the dev server logs
// "Blocked cross-origin request": unset keeps Next's default warn-only
// behavior, while setting it switches that protection to block mode for
// anything not listed. Never put a rotating Quick Tunnel hostname here
// permanently; set it per tunnel session if needed at all.
const devOrigins = (process.env.HERMES_DEV_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  // Prevent Next.js from inferring a parent workspace root from monorepo traversal, which
  // changes the standalone output path layout and breaks systemd start paths.
  outputFileTracingRoot: path.join(__dirname),
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  async redirects() {
    return [
      {
        source: '/agents',
        destination: '/agents/squads',
        permanent: false,
      },
    ];
  },
  // Baseline hardening headers (#137). Notes on the trade-offs:
  // - script-src keeps 'unsafe-inline' because Next.js itself emits inline
  //   bootstrap scripts; tightening further needs per-request nonces.
  // - style-src keeps 'unsafe-inline' for Tailwind output and inline styles.
  // - frame-src allows https embeds because operators configure their own
  //   analytics iframe URLs; framing OF this app stays same-origin.
  // - HSTS is emitted unconditionally (browsers ignore it over plain HTTP,
  //   so local development is unaffected).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              'frame-src https:',
              "form-action 'self'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
