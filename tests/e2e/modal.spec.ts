import { expect, test } from '@playwright/test';

/* Regression tests for issue #153: modal backdrops were focusable invisible
 * buttons with no Escape handling, focus trap, or (for cron) scroll-lock.
 * Both dialogs now share the Modal shell. */

async function login(page: import('@playwright/test').Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: 'admin_e2e', password: 'super-secure-pass' },
  });
  expect(res.status()).toBe(200);
}

test.describe('modal shell', () => {
  test('CRM add-lead dialog closes on Escape and has no backdrop button (#153)', async ({ page }) => {
    await login(page);
    await page.goto('/crm');
    await page.getByRole('button', { name: 'Add Lead' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The old backdrop was a focusable button named exactly "Close".
    await expect(page.locator('button[aria-label="Close"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
