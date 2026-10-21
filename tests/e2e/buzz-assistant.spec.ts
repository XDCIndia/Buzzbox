import { expect, test, type Page, type Route } from '@playwright/test';

/* Issue #225: an upstream LLM outage must not leave the Buzz chat with a
 * permanent crash bubble or a corrupted thread. The chat must render the
 * server's clean, status-based error with a Retry action (only when the server
 * says the failure is retryable), replace the failure bubble instead of
 * appending duplicates, and recover completely when a retry succeeds.
 *
 * /api/buzz is fulfilled at the network layer so these specs assert the exact
 * response shapes the route produces (see src/lib/buzz-route-upstream.test.ts
 * and src/lib/dicompute-retry.test.ts for the server side) without depending
 * on the real provider's health -- and without changing the shared e2e server
 * env, which must stay key-less for the #88 missing-config spec. */

type Payload = { status: number; body: unknown };

function json(payload: Payload): Parameters<Route['fulfill']>[0] {
  return {
    status: payload.status,
    contentType: 'application/json',
    body: JSON.stringify(payload.body),
  };
}

/** Fulfill /api/buzz with a scripted sequence (last script repeats). */
async function mockBuzz(page: Page, scripts: Payload[]) {
  const calls: Payload[] = [];
  await page.route('**/api/buzz', async (route) => {
    const payload = scripts[Math.min(calls.length, scripts.length - 1)];
    calls.push(payload);
    await route.fulfill(json(payload));
  });
  return { calls, count: () => calls.length };
}

async function openBuzz(page: Page, message: string) {
  // These specs exercise the failure UX, not the pre-flight: pin the connector
  // as configured so they don't depend on the server's real DICOMPUTE_* env
  // (the unconfigured state has its own dedicated test below).
  await page.route('**/api/buzz/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, isAiConfigured: true }),
    }),
  );

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open Buzz AI assistant' }).click();
  const input = page.getByPlaceholder('Ask Buzz anything...');
  await input.fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
  return input;
}

const TRANSIENT_502: Payload = {
  status: 502,
  body: {
    ok: false,
    error:
      'Buzz AI is temporarily unavailable. The AI provider returned 502 Bad Gateway. Please try again later.',
    retryable: true,
  },
};

const RECOVERED: Payload = {
  status: 200,
  body: {
    ok: true,
    type: 'response',
    message: 'Buzzbox is a marketing operations command center.',
  },
};

test.describe('Buzz chat failure UX', () => {
  test('a transient failure shows Retry, and a successful retry replaces it without duplicating the thread (#225)', async ({
    page,
  }) => {
    const buzz = await mockBuzz(page, [TRANSIENT_502, RECOVERED]);

    const input = await openBuzz(page, 'What is Buzzbox?');

    // Clean status-based message, not a raw provider/fetch error.
    const error = page.getByText(
      'Buzz AI is temporarily unavailable. The AI provider returned 502 Bad Gateway. Please try again later.',
    );
    await expect(error).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    // The failed exchange keeps exactly one copy of the user message.
    await expect(page.getByText('What is Buzzbox?', { exact: true })).toHaveCount(1);

    // Retry re-sends the same message: the thread gains the answer, and the
    // crash bubble disappears instead of piling up.
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(
      page.getByText('Buzzbox is a marketing operations command center.'),
    ).toBeVisible();
    await expect(error).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.getByText('What is Buzzbox?', { exact: true })).toHaveCount(1);
    expect(buzz.count()).toBe(2);

    // Composer is clean and usable again.
    await expect(input).toHaveValue('');
    await expect(page.getByText('Buzz is thinking...')).toHaveCount(0);
  });

  test('a non-retryable failure (missing provider config) offers Dismiss but no Retry', async ({
    page,
  }) => {
    await mockBuzz(page, [
      {
        status: 412,
        body: {
          ok: false,
          error: 'DICOMPUTE_API_KEY is not configured. Buzz requires the Dicompute LLM connector -- set DICOMPUTE_API_KEY in the environment to enable it.',
          retryable: false,
        },
      },
    ]);

    await openBuzz(page, 'hii');

    await expect(
      page.getByText('DICOMPUTE_API_KEY is not configured'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();

    // Dismiss clears the bubble and leaves the user message intact.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('DICOMPUTE_API_KEY is not configured')).toHaveCount(0);
    await expect(page.getByText('hii', { exact: true })).toHaveCount(1);
  });

  test('a non-JSON error body renders a clean fallback, never a raw parse error (#51)', async ({
    page,
  }) => {
    await page.route('**/api/buzz', async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><h1>cloudflare</h1>502 Bad gateway</body></html>',
      });
    });

    await openBuzz(page, 'What is Buzzbox?');

    const error = page.getByText('Request failed with status 502');
    await expect(error).toBeVisible();
    await expect(page.locator('body')).not.toContainText('<!DOCTYPE html>');
    await expect(page.locator('body')).not.toContainText('Unexpected token');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByText('What is Buzzbox?', { exact: true })).toHaveCount(1);
  });

  test('unconfigured connector: offline badge, disabled composer, no request (#225)', async ({
    page,
  }) => {
    const buzzCalls: number[] = [];

    await page.route('**/api/buzz/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, isAiConfigured: false }),
      }),
    );
    await page.route('**/api/buzz', async (route) => {
      buzzCalls.push(1);
      await route.fulfill({
        status: 412,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'DICOMPUTE_API_KEY is not configured. Buzz requires the Dicompute LLM connector -- set DICOMPUTE_API_KEY in the environment to enable it.',
          retryable: false,
        }),
      });
    });

    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Open Buzz AI assistant' }).click();

    // Status badge flips from the green active dot to Unconfigured.
    await expect(page.getByText('Unconfigured')).toBeVisible();

    // The greeting no longer invites a chat that cannot work, and the
    // warning card explains how to fix it.
    await expect(page.getByText('What would you like me to do?')).toHaveCount(0);
    await expect(page.getByText('Set DICOMPUTE_API_KEY in your environment')).toBeVisible();

    // Composer and quick suggestions are unavailable.
    await expect(page.getByPlaceholder('Ask Buzz anything...')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await expect(page.getByRole('button', { name: "Today's overview" })).toHaveCount(0);

    // Even a programmatic quick-action must not reach the server: no user
    // bubble, no guaranteed failure in the thread.
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('buzz:ask', { detail: { prompt: 'hii' } }),
      ),
    );
    await page.waitForTimeout(750);
    expect(buzzCalls.length).toBe(0);
    await expect(page.getByText('hii', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });
});
