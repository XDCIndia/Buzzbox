import { expect, test, type APIRequestContext } from '@playwright/test';

/* Regression coverage for fixes shipped 2026-09-23 (#95/#92):
 *  - #86 CSRF: loopback origins (127.0.0.1 <-> localhost) are accepted at the
 *    same scheme+port; cross-site origins and missing Origin are rejected.
 *  - #69 sync health: /api/settings exposes real recorded sync state.
 *  - #85 approvals history: approval transitions performed through
 *    /api/content reach the approvals history panel.
 *  - #67 deep link: /agents/comms?conv=<id> renders (route exists, no 500).
 *  - #88/#90 error contracts: buzz without a provider key is 412, unknown
 *    content-item ids are graceful JSON 404s. */

test.describe('regression battery', () => {
  const loginPayload = {
    username: 'admin_e2e',
    password: 'super-secure-pass',
  };

  // Reuse one session across all tests: each Playwright test gets a fresh
  // request context, and logging in per test would exhaust the login rate
  // limiter (10 attempts/min/IP) now that the suite has 17+ tests.
  let cachedCookie: string | null = null;

  async function getAuthHeaders(request: APIRequestContext) {
    if (cachedCookie) return { cookie: cachedCookie };
    const login = await request.post('/api/auth/login', {
      data: loginPayload,
    });
    expect(login.status()).toBe(200);
    const sessionCookie = login.headers()['set-cookie'];
    expect(sessionCookie).toContain('hermes-session=');
    cachedCookie = sessionCookie;
    return { cookie: sessionCookie };
  }

  test('#86 missing Origin on a mutation is rejected (fail closed)', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.post('/api/sync', { headers });
    expect(res.status()).toBe(403);
  });

  test('#86 cross-site Origin is rejected', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.post('/api/sync', {
      headers: { ...headers, origin: 'https://evil.example.com' },
    });
    expect(res.status()).toBe(403);
  });

  test('#86 loopback Origin at the same scheme+port is accepted', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    // Server runs on 127.0.0.1:3010; a localhost origin is the same host.
    const res = await request.post('/api/sync', {
      headers: { ...headers, origin: 'http://localhost:3010' },
    });
    expect(res.status()).toBe(200);
  });

  test('#69 settings exposes real sync health after boot', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/settings', { headers });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      sync_health: {
        last_sync_status: string | null;
        last_sync_at: string | null;
        last_sync_error: string | null;
        last_success_at: string | null;
      };
    };
    expect(body.sync_health).toBeTruthy();
    expect(['ok', 'error', null]).toContain(body.sync_health.last_sync_status);
    if (body.sync_health.last_sync_status) {
      expect(body.sync_health.last_sync_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(body.sync_health.last_sync_at as string))).toBe(false);
    }
  });

  test('#85 approval transition reaches the approvals history panel', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const id = `e2e-approve-${Date.now()}`;
    const patch = await request.patch('/api/content', {
      headers: { ...headers, 'content-type': 'application/json', origin: 'http://127.0.0.1:3010' },
      data: { id, status: 'ready' },
    });
    expect(patch.status()).toBe(200);

    const history = await request.get('/api/approvals/history', { headers });
    expect(history.status()).toBe(200);
    const events = (await history.json()) as { history: { action: string; detail: string }[] };
    const match = events.history.find((e) => e.action === 'approve' && e.detail.includes(id));
    expect(match, 'approval must appear in history').toBeTruthy();
  });

  test('#67 comms deep-link route renders', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/agents/comms?conv=e2e-conv', { headers });
    expect(res.status()).toBe(200);
  });

  test('#88 buzz without a configured provider returns 412 with guidance', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.post('/api/buzz', {
      headers: { ...headers, 'content-type': 'application/json', origin: 'http://127.0.0.1:3010' },
      data: { message: 'e2e ping' },
    });
    expect(res.status()).toBe(412);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('DICOMPUTE_API_KEY is not configured');
  });

  test('#87 unknown content-item id returns graceful JSON 404', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/content-item?id=e2e-missing-id', { headers });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});
