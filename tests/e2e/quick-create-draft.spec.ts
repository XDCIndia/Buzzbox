import { expect, test } from '@playwright/test';

/* "New content draft" in the header Quick Create menu opens the manual
 * composer (/content/new) — no AI/Buzz involved. Saving stores a draft that
 * appears in the Content queue without publishing. */

test.describe('manual content composer', () => {
  test('New content draft opens the composer and saves an X draft to the queue', async ({ page }) => {
    await page.goto('/content');
    await expect(page.getByText('Content pipeline')).toBeVisible();

    await page.getByRole('button', { name: 'Quick create' }).click();
    await page.getByRole('menuitem', { name: /New content draft/ }).click();

    // Manual composer (not Buzz, no reload-in-place).
    await expect(page.getByText('New draft', { exact: true })).toBeVisible();
    const unique = `E2E manual draft ${Date.now()}`;
    await page.getByPlaceholder('Write your post…').fill(unique);
    // X is the default platform.
    await expect(page.getByRole('button', { name: 'X', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();

    // Back on the queue with the new draft listed (still a draft, unpublished).
    await expect(page).toHaveURL(/\/content$/);
    await expect(page.getByText(unique)).toBeVisible();
  });

  test('empty composer cannot be saved', async ({ page }) => {
    await page.goto('/content/new');
    await expect(page.getByPlaceholder('Write your post…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Draft', exact: true })).toBeDisabled();
  });

  test('draft can be submitted for approval and appears in Approvals', async ({ page }) => {
    await page.goto('/content/new');
    const unique = `E2E approval draft ${Date.now()}`;
    await page.getByPlaceholder('Write your post…').fill(unique);
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(page).toHaveURL(/\/content$/);

    // Submit the new draft row for approval (drafts never publish directly).
    const row = page.locator('tbody tr', { hasText: unique });
    await row.getByRole('button', { name: 'Submit for Approval' }).click();
    await expect(page.getByText('Submitted for approval')).toBeVisible({ timeout: 10000 });

    // Approvals now lists it as pending via the existing mechanism.
    await page.goto('/approvals');
    await expect(page.getByText('Approvals', { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(unique)).toBeVisible({ timeout: 15000 });
  });
});
