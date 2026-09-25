import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { test } from 'node:test';

/* Regression guard for issue #99: the edge proxy authorizes /api/* requests
 * on session-cookie *presence*, not validity -- so any route handler that
 * forgets its auth guard is effectively public (this is how GET
 * /api/dicompute-test shipped as an unauthenticated paid-LLM endpoint).
 * Every route.ts outside api/auth/* must reference an auth primitive.
 * If this test fails, the new route needs requireApi* (or requireAdmin /
 * secureCompare for the users-table and webhook cases) before merge. */

const GUARD_PATTERN = /requireApi\w*|requireAdmin|requireUser|secureCompare|getUserFromRequest/;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === 'route.ts') {
      out.push(join(entry.parentPath ?? dir, entry.name));
    }
  }
  return out;
}

const apiDir = join(process.cwd(), 'src', 'app', 'api');
const files = routeFiles(apiDir);
assert.ok(files.length > 50, `expected the full API tree, found only ${files.length} route files`);

// Login / logout / OAuth callback flows are public by design (and the proxy
// explicitly allows /api/auth/* without a session).
const isPublicAuthFlow = (f: string) => f.split(sep).includes('auth');

test('every non-auth API route references an auth guard (#99)', () => {
  const offenders = files
    .filter(f => !isPublicAuthFlow(f))
    .filter(f => !GUARD_PATTERN.test(readFileSync(f, 'utf-8')));
  assert.deepEqual(offenders, []);
});
