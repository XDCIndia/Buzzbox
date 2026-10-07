import { expect, test } from '@playwright/test';

test.describe('auth and api gate', () => {
  // Authenticated via the suite-wide storage state (global-setup.ts); no
  // per-test login, keeping the suite under the login rate limiter (#201).
  test('blocks protected api without authentication', async ({ playwright, baseURL }) => {
    // Fresh context with explicitly empty storage: the suite-wide session
    // must not leak in here (newContext inherits config storageState).
    const fresh = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const res = await fresh.get('/api/overview');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
    await fresh.dispose();
  });

  test('allows protected api after login', async ({ request }) => {
    const res = await request.get('/api/overview');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(payload).toHaveProperty('stats');
  });

  test('crm api returns leads and summary after login', async ({ request }) => {
    const res = await request.get('/api/crm');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.leads)).toBeTruthy();
    expect(payload).toHaveProperty('summary');
    expect(payload.summary).toHaveProperty('total');
  });

  test('outreach api returns funnel payload after login', async ({ request }) => {
    const res = await request.get('/api/outreach');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.leads)).toBeTruthy();
    expect(Array.isArray(payload.funnel)).toBeTruthy();
    expect(Array.isArray(payload.pendingApprovals)).toBeTruthy();
  });

  test('content api returns post list after login', async ({ request }) => {
    const res = await request.get('/api/content');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload)).toBeTruthy();
  });

  test('analytics api returns provider payload after login', async ({ request }) => {
    const res = await request.get('/api/analytics?days=30');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(payload.days).toBe(30);
    expect(payload).toHaveProperty('website');
    expect(payload).toHaveProperty('social');
    expect(payload.social.provider).toBe('internal');
  });

  test('cron api returns jobs payload after login', async ({ request }) => {
    const res = await request.get('/api/cron');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.jobs)).toBeTruthy();
    expect(typeof payload.can_write).toBe('boolean');
  });

  test('settings api returns db summary after login', async ({ request }) => {
    const res = await request.get('/api/settings');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.tables)).toBeTruthy();
    expect(typeof payload.db_size_mb).toBe('number');
  });

  test('cycle-time benchmark api returns before/after deltas after login', async ({ request }) => {
    const res = await request.get('/api/benchmarks/cycle-time?days=30');
    expect(res.status()).toBe(200);
    const payload = await res.json();
    expect(payload.metric).toBe('lead_to_approved_campaign_cycle_time_hours');
    expect(payload).toHaveProperty('before');
    expect(payload).toHaveProperty('after');
    expect(payload).toHaveProperty('delta');
    expect(Array.isArray(payload.inclusion_rules)).toBeTruthy();
  });
});
