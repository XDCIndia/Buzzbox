/**
 * Cross-platform webServer launcher for Playwright E2E runs.
 *
 * The previous inline command (`PORT=3010 ... node .next/standalone/server.js`)
 * used POSIX env-var prefix syntax, which Windows shells cannot execute. This
 * launcher sets the same environment defaults in-process and then starts the
 * standalone Next.js server, so `pnpm test:e2e` works identically on Linux
 * (CI) and Windows (local). Values from playwright.config.ts `webServer.env`
 * still override these defaults.
 */

process.env.PORT = process.env.PORT || '3010';
process.env.HOSTNAME = process.env.HOSTNAME || '127.0.0.1';

await import('../.next/standalone/server.js');
