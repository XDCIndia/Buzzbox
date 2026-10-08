import { expect, test } from '@playwright/test';

/* Regression tests for issues #175/#176: the mobile nav sheet and the header
 * quick-create menu (plus the data-status and notification popovers sharing
 * the hook) only dismissed on outside mousedown — Escape did nothing. All
 * four now share useDismiss (Escape + outside pointer-down).
 *
 * Authenticated via the suite-wide storage state (global-setup.ts). */

test.describe('escape dismissal', () => {
  test('mobile sheet and quick-create menu close on Escape (#175, #176)', async ({ page }) => {

    // #175: mobile nav sheet at a phone viewport.
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Open full menu drawer' }).click();
    const sheet = page.getByRole('dialog', { name: 'Navigation Menu' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // #176: header quick-create menu at desktop width.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    const trigger = page.getByRole('button', { name: 'Quick create' });
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
