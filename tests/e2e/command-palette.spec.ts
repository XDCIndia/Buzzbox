import { expect, test } from '@playwright/test';

/* Regression test for issue #138: the command palette discarded search
 * result ids and always landed on generic list pages. A lead result must
 * deep-link to its record page (/crm/[id]). */

test.describe('command palette', () => {
  test('lead result deep-links to its record page (#138)', async ({ page, request }) => {
    const unique = `Palette${Date.now()}`;
    const created = await request.post('/api/leads', {
      headers: { 'x-api-key': 'e2e-api-key' },
      data: { first_name: unique, last_name: 'Probe', status: 'new' },
    });
    expect(created.status()).toBe(200);

    const login = await page.request.post('/api/auth/login', {
      data: { username: 'admin_e2e', password: 'super-secure-pass' },
    });
    expect(login.status()).toBe(200);

    await page.goto('/dashboard');
    // Open via the header button (not a blind Cmd+K): the click waits for
    // hydration, so the palette listener is guaranteed to be attached.
    await page.getByRole('button', { name: 'Search application' }).click();
    const input = page.getByPlaceholder('Search leads, content, signals... or navigate');
    await expect(input).toBeVisible();
    await input.fill(unique);

    const result = page.locator('button', { hasText: unique }).first();
    await expect(result).toBeVisible();
    await result.click();

    await page.waitForURL(/\/crm\/.+/);
    expect(page.url()).not.toContain('/outreach');
  });
});
