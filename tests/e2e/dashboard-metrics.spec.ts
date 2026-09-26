import { expect, test } from '@playwright/test';

/* Regression test for issue #117: MetricColumn rendered every KPI's value
 * block twice (a duplicated JSX block), so each dashboard label appeared
 * two times. The empty E2E database renders SetupChecklist instead of the
 * metric bar, so /api/overview is stubbed with non-zero stats; the label
 * count then discriminates cleanly (2 before the fix, 1 after). */

const overviewStub = {
  stats: {
    posts_today: 5,
    engagement_today: 12,
    emails_sent: 3,
    pipeline_count: 7,
  },
  alerts: [],
  recentActivity: [],
  metrics: [],
  agents: [],
  action_items: [],
};

function stubOverview(page: import('@playwright/test').Page, metrics: object[] = []) {
  return page.route('**/api/overview*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...overviewStub, metrics }),
    });
  });
}

async function login(page: import('@playwright/test').Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: 'admin_e2e', password: 'super-secure-pass' },
  });
  expect(res.status()).toBe(200);
}

test.describe('dashboard metric bar', () => {
  test('each KPI label renders exactly once (#117)', async ({ page }) => {
    await login(page);
    await stubOverview(page);
    await page.goto('/dashboard');

    for (const label of ['Posts Today', 'Engagements Today', 'Emails Sent', 'Pipeline']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(1);
    }
  });

  test('Pipeline card shows no foreign delta/sparkline (#139)', async ({ page }) => {
    await login(page);
    const metrics = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      x_posts: 0,
      x_threads: 0,
      linkedin_drafts: 0,
      x_replies: 0,
      x_quote_tweets: 0,
      x_follows: 0,
      linkedin_comments: 0,
      discoveries: 2 + i,
      enrichments: 0,
      sends: 5 + i,
      replies_triaged: 0,
      opt_outs: 0,
      bounces: 0,
      total_impressions: 100 + i * 10,
      total_engagement: 50 + i,
    }));
    await stubOverview(page, metrics);
    await page.goto('/dashboard');

    // Posts/Engagements/Emails render one sparkline each; Pipeline must not
    // borrow the discoveries series anymore. (Lucide icons are also SVGs,
    // so we count Recharts containers, not svg elements.)
    await expect(page.locator('.metric-bar .recharts-responsive-container')).toHaveCount(3);
  });
});
