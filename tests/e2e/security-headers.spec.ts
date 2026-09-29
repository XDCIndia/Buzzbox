import { expect, test } from '@playwright/test';

/* Regression test for issue #137: the app set no security headers (CSP,
 * HSTS, framing, MIME-sniff protection). next.config.ts now emits a
 * baseline for every route, asserted here on both a public page and an
 * (unauthenticated) API response. */

const EXPECTED: Array<[string, RegExp]> = [
  ['x-frame-options', /^SAMEORIGIN$/i],
  ['x-content-type-options', /^nosniff$/i],
  ['referrer-policy', /.+/],
  ['strict-transport-security', /max-age=63072000/],
  ['content-security-policy', /default-src 'self'/],
];

test.describe('security headers', () => {
  for (const url of ['/login', '/api/overview']) {
    test(`hardening headers present on ${url} (#137)`, async ({ request }) => {
      const res = await request.get(url);
      for (const [header, pattern] of EXPECTED) {
        const value = res.headers()[header];
        expect(value, `missing ${header} on ${url}`).toBeTruthy();
        expect(value).toMatch(pattern);
      }
    });
  }

  test('framing is same-origin only (#137)', async ({ request }) => {
    const res = await request.get('/login');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
  });
});
