import { expect, test, type APIRequestContext } from '@playwright/test';

test.describe('auth and api gate', () => {
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

  test('blocks protected api without authentication', async ({ request }) => {
    const res = await request.get('/api/overview');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  test('allows protected api after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);

    const res = await request.get('/api/overview', {
      headers,
    });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(payload).toHaveProperty('stats');
  });

  test('crm api returns leads and summary after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/crm', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.leads)).toBeTruthy();
    expect(payload).toHaveProperty('summary');
    expect(payload.summary).toHaveProperty('total');
  });

  test('outreach api returns funnel payload after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/outreach', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.leads)).toBeTruthy();
    expect(Array.isArray(payload.funnel)).toBeTruthy();
    expect(Array.isArray(payload.pendingApprovals)).toBeTruthy();
  });

  test('content api returns post list after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/content', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload)).toBeTruthy();
  });

  test('analytics api returns provider payload after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/analytics?days=30', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(payload.days).toBe(30);
    expect(payload).toHaveProperty('website');
    expect(payload).toHaveProperty('social');
    expect(payload.social.provider).toBe('internal');
  });

  test('cron api returns jobs payload after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/cron', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.jobs)).toBeTruthy();
    expect(typeof payload.can_write).toBe('boolean');
  });

  test('settings api returns db summary after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/settings', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.tables)).toBeTruthy();
    expect(typeof payload.db_size_mb).toBe('number');
  });

  test('cycle-time benchmark api returns before/after deltas after login', async ({ request }) => {
    const headers = await getAuthHeaders(request);
    const res = await request.get('/api/benchmarks/cycle-time?days=30', { headers });
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(payload.metric).toBe('lead_to_approved_campaign_cycle_time_hours');
    expect(payload).toHaveProperty('before');
    expect(payload).toHaveProperty('after');
    expect(payload).toHaveProperty('delta');
    expect(Array.isArray(payload.inclusion_rules)).toBeTruthy();
  });
});
