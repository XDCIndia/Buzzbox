import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3010',
    trace: 'on-first-retry',
  },
  webServer: {
    // Cross-platform launcher (POSIX `VAR=x` prefixes break on Windows shells).
    command: 'node scripts/e2e-server.mjs',
    port: 3010,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_USER: 'admin_e2e',
      AUTH_PASS: 'super-secure-pass',
      API_KEY: 'e2e-api-key',
      AUTH_COOKIE_SECURE: 'false',
      HERMES_STATE_DIR: '.tmp/e2e-state',
      HERMES_HOST_LOCK: 'local',
      NODE_ENV: 'test',
    },
  },
});
