import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';

/* Suite-wide authentication (#201): logging in per test exhausts the login
 * rate limiter (10 attempts/min/IP) once spec files run in parallel workers.
 * This setup logs in ONCE per run as admin_e2e and persists the session to
 * storage state, which the config applies to every page and request fixture
 * — specs must NOT POST /api/auth/login themselves. */

const STATE_PATH = 'test-results/.auth/state.json';

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:3010';
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'admin_e2e', password: 'super-secure-pass' },
  });
  if (login.status() !== 200) {
    await browser.close();
    throw new Error(`global setup login failed with status ${login.status()}`);
  }
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STATE_PATH });
  await browser.close();
}

export default globalSetup;
