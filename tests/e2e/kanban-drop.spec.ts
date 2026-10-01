import { expect, test } from '@playwright/test';

/* Regression test for issue #173: dropping a lead card onto a kanban column
 * at/past the board's horizontal clip edge did nothing — no PATCH, no toast —
 * because the native drop resolved to the scroll container instead of the
 * column, and the container had no drop handler. The board now dispatches
 * drops itself (direct column hit, else the nearest column at the drop
 * height), so container-space drops move the lead.
 *
 * The test performs a real native mouse drag into the inter-column gap
 * (pure container space — the old code's silent-failure geometry) and asserts
 * the move toast plus server-side persistence. */

async function login(page: import('@playwright/test').Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { username: 'admin_e2e', password: 'super-secure-pass' },
  });
  expect(res.status()).toBe(200);
}

test.describe('kanban clipped drop', () => {
  test('drop into container-space gap moves the lead with feedback (#173)', async ({ page }) => {
    // Timing-sensitive native drag: triple the default 30s timeout.
    test.slow();
    await login(page);

    // #183: over-length creates are rejected with a field error, never sliced.
    const overlong = await page.request.post('/api/leads', {
      headers: { origin: 'http://127.0.0.1:3010' },
      data: { first_name: 'x'.repeat(300), last_name: 'Limit' },
    });
    expect(overlong.status()).toBe(400);
    expect(String(((await overlong.json()) as { error?: string }).error)).toContain('Invalid first_name');

    // Clean up leads orphaned by earlier interrupted runs sharing the tags.
    const existing = (await (await page.request.get('/api/leads', {})).json()) as { id: string; first_name: string | null }[];
    for (const lead of existing.filter((l) => l.first_name?.startsWith('KDrop') || l.first_name?.startsWith('KDebug'))) {
      await page.request.delete('/api/leads', { headers: { origin: 'http://127.0.0.1:3010' }, data: { id: lead.id } });
    }

    const tag = `KDrop${Date.now()}`;
    // Mutations require a same-origin Origin header (CSRF fail-closed, #86).
    const originHeaders = { origin: 'http://127.0.0.1:3010' };
    const created = await page.request.post('/api/leads', {
      headers: originHeaders,
      data: { first_name: tag, last_name: 'Lead', status: 'new' },
    });
    expect(created.status()).toBe(200);
    const leadId = ((await created.json()) as { lead: { id: string } }).lead.id;

    try {
      // Stage the card next to the target gap so source and gap share the viewport.
      const staged = await page.request.patch('/api/crm', {
        headers: originHeaders,
        data: { id: leadId, status: 'booked' },
      });
      expect(staged.status()).toBe(200);

      // Tall viewport: the board fits vertically while staying horizontally
      // clipped (the bug's configuration). Short viewports push the drop
      // point below the fold, where mouse-up dispatches nothing.
      await page.setViewportSize({ width: 900, height: 1200 });
      await page.goto('/crm?view=kanban');
      // Scroll until BOTH the source and target columns are on-screen, and
      // keep retrying: poll refreshes can remount the board and reset scroll.
      await page.waitForFunction(
        (needle: string) => {
          const board = document.querySelector('[data-kanban-stage]')?.parentElement;
          const booked = board?.querySelector('[data-kanban-stage="booked"]');
          const qual = board?.querySelector('[data-kanban-stage="qualified"]');
          const card = Array.from(board?.querySelectorAll('[data-kanban-stage="booked"] button') ?? []).find((b) =>
            b.textContent?.includes(needle),
          );
          if (!board || !booked || !qual || !card) return false;
          const bRect = booked.getBoundingClientRect();
          const qRect = qual.getBoundingClientRect();
          const cRect = (card as HTMLElement).getBoundingClientRect();
          if (
            bRect.left >= 0 && qRect.right <= window.innerWidth &&
            cRect.left >= 0 && cRect.right <= window.innerWidth && cRect.width > 0
          ) return true;
          board.scrollLeft = board.scrollWidth;
          return false;
        },
        tag,
        { polling: 250, timeout: 30_000 },
      );

      const card = page.locator('[data-kanban-stage="booked"] button', { hasText: tag });
      const srcBox = await card.boundingBox();
      const bookedBox = await page.locator('[data-kanban-stage="booked"]').boundingBox();
      const qualBox = await page.locator('[data-kanban-stage="qualified"]').boundingBox();
      expect(srcBox && bookedBox && qualBox).toBeTruthy();
      // Midpoint of the inter-column gap: container space in old and new code.
      const gapX = (bookedBox!.x + bookedBox!.width + qualBox!.x) / 2;
      const gapY = bookedBox!.y + bookedBox!.height / 2;
      const srcX = srcBox!.x + srcBox!.width / 2;
      const srcY = srcBox!.y + srcBox!.height / 2;
      // Every coordinate must be inside the viewport: mouse events outside it
      // never start (source) or complete (drop) the drag.
      for (const [x, y] of [[srcX, srcY], [gapX, gapY]] as const) {
        expect(x, 'drag coordinate inside viewport width').toBeGreaterThan(0);
        expect(x, 'drag coordinate inside viewport width').toBeLessThan(900);
        expect(y, 'drag coordinate inside viewport height').toBeGreaterThan(0);
        expect(y, 'drag coordinate inside viewport height').toBeLessThan(1200);
      }

      await page.mouse.move(srcX, srcY);
      await page.mouse.down();
      await page.mouse.move(gapX, gapY, { steps: 25 });
      await page.mouse.up();

      const toast = page.getByText(/Lead moved to (booked|qualified)/);
      await expect(toast).toBeVisible({ timeout: 10_000 });
      const movedStage = ((await toast.textContent()) ?? '').match(/Lead moved to (\w+)/)?.[1];

      const res = await page.request.get('/api/leads', {});
      expect(res.status()).toBe(200);
      const leads = (await res.json()) as { id: string; status: string }[];
      expect(leads.find((l) => l.id === leadId)?.status, 'toast stage must persist server-side').toBe(movedStage);
    } finally {
      await page.request.delete('/api/leads', { headers: originHeaders, data: { id: leadId } });
    }
  });
});
