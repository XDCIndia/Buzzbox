import { expect, test } from '@playwright/test';

/* Regression tests for issue #174: the brand Alerts/Campaigns create forms
 * silently ignored empty submits (early return, no feedback). Empty and
 * whitespace-only names now toast an error and create nothing; valid names
 * still create. */

// Seeded default brand (src/lib/brand-constants.ts DEFAULT_BRAND_ID).
const BRAND_ID = '97cdb115-2c90-42a8-b904-d14abce1d682';
const ORIGIN = { origin: 'http://127.0.0.1:3010' };

async function login(page: import('@playwright/test').Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: 'admin_e2e', password: 'super-secure-pass' },
  });
  expect(res.status()).toBe(200);
}

async function apiList(page: import('@playwright/test').Page, kind: 'alerts' | 'campaigns') {
  const res = await page.request.get(`/api/brand/${BRAND_ID}/${kind}`, {});
  expect(res.status()).toBe(200);
  return (await res.json()) as { id: string; name: string }[];
}

async function apiDigestList(page: import('@playwright/test').Page) {
  const res = await page.request.get(`/api/brand/${BRAND_ID}/digests`, {});
  expect(res.status()).toBe(200);
  return (await res.json()) as { id: string; title: string }[];
}

test.describe('brand create validation', () => {
  test('empty alert submit toasts instead of silently doing nothing (#174)', async ({ page }) => {
    await login(page);
    const before = await apiList(page, 'alerts');

    await page.goto(`/brand/${BRAND_ID}/create/alerts`);
    const nameInput = page.getByLabel('Alert name');
    await expect(nameInput).toBeVisible();

    await nameInput.fill('   ');
    await page.getByRole('button', { name: 'New Alert' }).click();
    await expect(page.getByText('Alert name is required').first()).toBeVisible({ timeout: 10_000 });

    await nameInput.fill('');
    await page.getByRole('button', { name: 'New Alert' }).click();
    await expect(page.getByText('Alert name is required').first()).toBeVisible({ timeout: 10_000 });

    expect(await apiList(page, 'alerts')).toEqual(before);

    // Server backstop: whitespace-only names are rejected API-side too.
    const wsRes = await page.request.post(`/api/brand/${BRAND_ID}/alerts`, {
      headers: { ...ORIGIN, 'content-type': 'application/json' },
      data: { name: '   ' },
    });
    expect(wsRes.status()).toBe(400);

    // Positive control: a real name still creates.
    const alertName = `E2E Alert ${Date.now()}`;
    await nameInput.fill(alertName);
    await page.getByRole('button', { name: 'New Alert' }).click();
    await expect(page.getByText(alertName)).toBeVisible({ timeout: 10_000 });

    const created = (await apiList(page, 'alerts')).find((a) => a.name === alertName);
    expect(created, 'alert must exist server-side').toBeTruthy();

    // #178: a failing check must surface the error, never "undefined matches".
    const row = page.locator('.brand-stat-tile', { hasText: alertName });
    await page.route('**/api/brand/*/alerts/*/check', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'E2E forced failure' }) }),
    );
    await row.getByRole('button', { name: 'Check now' }).click();
    await expect(row.getByText('E2E forced failure')).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('undefined matches')).toHaveCount(0);
    await page.unroute('**/api/brand/*/alerts/*/check');

    // Positive control: a real check reports a match count.
    await row.getByRole('button', { name: 'Check now' }).click();
    await expect(row.getByText('0 matches')).toBeVisible({ timeout: 10_000 });

    // #179: dismissing the confirm deletes nothing and toasts nothing.
    page.once('dialog', (d) => d.dismiss());
    await row.getByRole('button', { name: `Delete alert ${alertName}` }).click();
    expect(await apiList(page, 'alerts').then((l) => l.some((a) => a.name === alertName))).toBe(true);

    // #179: a failing delete surfaces the error and keeps the alert.
    await page.route(`**/api/brand/${BRAND_ID}/alerts/${created!.id}`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'E2E delete failure' }) }),
    );
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: `Delete alert ${alertName}` }).click();
    await expect(page.getByText('E2E delete failure').first()).toBeVisible({ timeout: 10_000 });
    expect(await apiList(page, 'alerts').then((l) => l.some((a) => a.name === alertName))).toBe(true);
    await page.unroute(`**/api/brand/${BRAND_ID}/alerts/${created!.id}`);

    // #179: accepting the confirm deletes with a success toast (also the cleanup).
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: `Delete alert ${alertName}` }).click();
    await expect(page.getByText('Alert deleted').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(alertName)).toBeHidden({ timeout: 10_000 });
    expect(await apiList(page, 'alerts').then((l) => l.some((a) => a.name === alertName))).toBe(false);

    // #180: digest flows share this login (suite login budget). Start clean.
    for (const d of await apiDigestList(page)) {
      await page.request.delete(`/api/brand/${BRAND_ID}/digests/${d.id}`, { headers: ORIGIN });
    }

    // #180: a failing generate surfaces the error banner, never a garbage card.
    await page.goto(`/brand/${BRAND_ID}/create/digests`);
    await page.route('**/api/brand/*/digests', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'E2E generate failure' }) })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByText('E2E generate failure').first()).toBeVisible({ timeout: 10_000 });
    expect(await apiDigestList(page)).toEqual([]);
    await page.unroute('**/api/brand/*/digests');

    // #180: real generate adds a digest; UI delete (confirm+toast) removes it.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect.poll(async () => (await apiDigestList(page)).length, { timeout: 10_000 }).toBe(1);
    const fresh = (await apiDigestList(page))[0];
    await expect(page.getByText(fresh.title).first()).toBeVisible({ timeout: 10_000 });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: `Delete digest ${fresh.title}` }).click();
    await expect(page.getByText('Digest deleted').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(fresh.title)).toBeHidden({ timeout: 10_000 });
    expect(await apiDigestList(page)).toEqual([]);
  });

  test('empty campaign submit toasts instead of silently doing nothing (#174)', async ({ page }) => {
    await login(page);
    const before = await apiList(page, 'campaigns');

    await page.goto(`/brand/${BRAND_ID}/create/campaigns`);
    const nameInput = page.getByLabel('Campaign name');
    await expect(nameInput).toBeVisible();

    await nameInput.fill('   ');
    await page.getByRole('button', { name: 'Create Campaign' }).click();
    await expect(page.getByText('Campaign name is required').first()).toBeVisible({ timeout: 10_000 });

    await nameInput.fill('');
    await page.getByRole('button', { name: 'Create Campaign' }).click();
    await expect(page.getByText('Campaign name is required').first()).toBeVisible({ timeout: 10_000 });

    expect(await apiList(page, 'campaigns')).toEqual(before);

    // Server backstop: whitespace-only names are rejected API-side too.
    const wsRes = await page.request.post(`/api/brand/${BRAND_ID}/campaigns`, {
      headers: { ...ORIGIN, 'content-type': 'application/json' },
      data: { name: '   ' },
    });
    expect(wsRes.status()).toBe(400);

    // Positive control: a real name still creates.
    const campaignName = `E2E Campaign ${Date.now()}`;
    await nameInput.fill(campaignName);
    await page.getByRole('button', { name: 'Create Campaign' }).click();
    await expect(page.getByText(campaignName)).toBeVisible({ timeout: 10_000 });

    const created = (await apiList(page, 'campaigns')).find((c) => c.name === campaignName);
    expect(created, 'campaign must exist server-side').toBeTruthy();

    // #179 (same pattern): accepting the confirm deletes with a toast (also the cleanup).
    const campaignRow = page.locator('.brand-stat-tile', { hasText: campaignName });
    page.once('dialog', (d) => d.accept());
    await campaignRow.getByRole('button', { name: `Delete campaign ${campaignName}` }).click();
    await expect(page.getByText('Campaign deleted').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(campaignName)).toBeHidden({ timeout: 10_000 });
    expect(await apiList(page, 'campaigns').then((l) => l.some((c) => c.name === campaignName))).toBe(false);
  });
});
