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

test.describe('dashboard metric bar', () => {
  test('each KPI label renders exactly once (#117)', async ({ page }) => {
    const login = await page.request.post('/api/auth/login', {
      data: { username: 'admin_e2e', password: 'super-secure-pass' },
    });
    expect(login.status()).toBe(200);

    await page.route('**/api/overview*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(overviewStub),
      });
    });

    await page.goto('/dashboard');

    for (const label of ['Posts Today', 'Engagements Today', 'Emails Sent', 'Pipeline']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(1);
    }
  });
});
