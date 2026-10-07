import { expect, test } from '@playwright/test';

/* Regression tests for issue #153: modal backdrops were focusable invisible
 * buttons with no Escape handling, focus trap, or (for cron) scroll-lock.
 * Both dialogs now share the Modal shell. */

test.describe('modal shell', () => {
  test('CRM add-lead dialog closes on Escape and has no backdrop button (#153)', async ({ page }) => {
    await page.goto('/crm');
    await page.getByRole('button', { name: 'Add Lead' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The old backdrop was a focusable button named exactly "Close".
    await expect(page.locator('button[aria-label="Close"]')).toHaveCount(0);

    // #183: inputs carry the server caps so over-length can never be typed.
    await expect(dialog.getByLabel('First name', { exact: true })).toHaveAttribute('maxlength', '80');
    await expect(dialog.getByLabel('Company', { exact: true })).toHaveAttribute('maxlength', '160');
    await expect(dialog.getByLabel('Notes', { exact: true })).toHaveAttribute('maxlength', '20000');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // #171: filter dropdowns expose accessible names (same login session —
    // the suite shares a 10/min login budget).
    const filters: [string, string][] = [
      ['/content', 'Filter by status'],
      ['/research', 'Filter by signal type'],
      ['/research', 'Filter by relevance'],
      ['/activity', 'Filter by action'],
      ['/memory', 'Select instance'],
    ];
    for (const [url, label] of filters) {
      await page.goto(url);
      await expect(page.getByLabel(label, { exact: true })).toBeVisible({ timeout: 15_000 });
    }
  });
});
