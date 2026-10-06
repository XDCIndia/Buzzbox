import { expect, test } from '@playwright/test';

/* The Dashboard setup checklist must reflect the same per-user X OAuth
 * status the Integrations page reports (/api/integrations/x). It previously
 * read NEXT_PUBLIC_X_USERNAME (never set) and settings.integrations.x (a
 * field /api/settings never returns), so "Connect the X account" stayed
 * incomplete forever even with @buzzboxtest connected.
 *
 * Single login for the whole spec: the e2e login endpoint is rate-limited
 * (10/min), so both phases share one session and reload between stubs. */

async function login(page: import('@playwright/test').Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: 'admin_e2e', password: 'super-secure-pass' },
  });
  expect(res.status()).toBe(200);
}

// The checklist only renders on an empty workspace (all overview stats
// zero); the shared e2e database accumulates rows from other specs, so pin
// the overview to zero like dashboard-metrics.spec.ts does.
function stubEmptyOverview(page: import('@playwright/test').Page) {
  return page.route('**/api/overview*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stats: { posts_today: 0, engagement_today: 0, emails_sent: 0, pipeline_count: 0 },
        alerts: [],
        recentActivity: [],
        metrics: [],
        agents: [],
        action_items: [],
      }),
    });
  });
}

function stubXStatus(page: import('@playwright/test').Page, body: object) {
  return page.route('**/api/integrations/x', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('dashboard setup checklist X step', () => {
  test('X step follows /api/integrations/x (OAuth, not env)', async ({ page }) => {
    await login(page);
    await stubEmptyOverview(page);

    // Disconnected (as Integrations reports it): hint visible = incomplete.
    await stubXStatus(page, { connected: false });
    await page.goto('/dashboard');
    await expect(page.getByText('Connect the X account', { exact: true })).toBeVisible();
    await expect(page.getByText('Unlocks posting, search, and signals')).toBeVisible();

    // Connected (as Integrations reports it): hint hidden = done.
    await page.unroute('**/api/integrations/x');
    await stubXStatus(page, { connected: true, username: 'buzzboxtest' });
    await page.reload();
    await expect(page.getByText('Connect the X account', { exact: true })).toBeVisible();
    await expect(page.getByText('Unlocks posting, search, and signals')).toHaveCount(0);
  });
});
