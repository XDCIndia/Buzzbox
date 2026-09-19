import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/* Regression guard for issue #54: API catch-alls must never echo raw error
 * objects to clients (better-sqlite3 errors embed full SQL + bound values).
 * If this test fails, someone reintroduced `{ error: String(error) }` —
 * log server-side with console.error and return a generic message instead. */

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

test('no route echoes raw errors into JSON responses (#54)', () => {
  const offenders = files.filter(f => {
    const src = readFileSync(f, 'utf-8');
    // Covers: { error: String(error) }, error: String(e), and template
    // interpolation like `Failed to ...: ${String(error)}`.
    return /\{ error: String\(err/.test(src) || /error: `\$\{String\(err/.test(src);
  });
  assert.deepEqual(offenders, []);
});

test('generic-500 hardening is actually in place across the API', () => {
  const hardened = files.filter(f => /['"]Internal server error['"]/.test(readFileSync(f, 'utf-8'))).length;
  assert.ok(hardened >= 16, `expected >=16 hardened routes, found ${hardened}`);
});
