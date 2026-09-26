import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #107: `pnpm build` (postbuild) required
 * bash+rsync, and the template export dropped the very .env.example its
 * next-steps message told you to copy. Both scripts are Node now; the pure
 * filter plus the copy routines are exercised here on temp fixtures.
 *
 * Dynamic .mjs imports (no env capture anywhere in these modules). */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-deploy-scripts-test-'));

let prepare: typeof import('../../scripts/prepare-standalone.mjs');
let templateExport: typeof import('../../scripts/template-export.mjs');

before(async () => {
  prepare = (await import('../../scripts/prepare-standalone.mjs')) as typeof import('../../scripts/prepare-standalone.mjs');
  templateExport = (await import('../../scripts/template-export.mjs')) as typeof import('../../scripts/template-export.mjs');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('shouldExclude keeps the env template but drops secrets and artifacts (#107)', () => {
  const { shouldExclude } = templateExport;
  assert.equal(shouldExclude('.env.example'), false);
  assert.equal(shouldExclude('.env'), true);
  assert.equal(shouldExclude('.env.local'), true);
  assert.equal(shouldExclude('.env.production'), true);
  assert.equal(shouldExclude('src/app/page.tsx'), false);
  assert.equal(shouldExclude('.next/static/chunk.js'), true);
  assert.equal(shouldExclude('.next/standalone/server.js'), true);
  assert.equal(shouldExclude('node_modules/next/package.json'), true);
  assert.equal(shouldExclude('state/hermes.db'), true);
  assert.equal(shouldExclude('hermes.db'), true);
  assert.equal(shouldExclude('x.db-wal'), true);
  assert.equal(shouldExclude('.tmp/e2e-state/hermes.db'), true);
  assert.equal(shouldExclude('test-results/results.json'), true);
  assert.equal(shouldExclude('playwright-report/index.html'), true);
  assert.equal(shouldExclude('hermes-seed-fix.bundle'), true);
  assert.equal(shouldExclude('.eslintcache'), true);
});

test('prepareStandalone copies static and public into the standalone tree (#107)', () => {
  const root = path.join(tempDir, 'app');
  mkdirSync(path.join(root, '.next', 'static'), { recursive: true });
  mkdirSync(path.join(root, 'public'), { recursive: true });
  writeFileSync(path.join(root, '.next', 'static', 'app.js'), 'js', 'utf-8');
  writeFileSync(path.join(root, 'public', 'logo.png'), 'png', 'utf-8');

  prepare.prepareStandalone(root);

  assert.equal(existsSync(path.join(root, '.next', 'standalone', '.next', 'static', 'app.js')), true);
  assert.equal(existsSync(path.join(root, '.next', 'standalone', 'public', 'logo.png')), true);
});

test('prepareStandalone tolerates missing source dirs (#107)', () => {
  const root = path.join(tempDir, 'empty-app');
  mkdirSync(root, { recursive: true });
  prepare.prepareStandalone(root);
  assert.equal(existsSync(path.join(root, '.next', 'standalone')), false);
});

test('exportTemplate ships source and template, drops the rest (#107)', () => {
  const root = path.join(tempDir, 'export-src');
  const files: Array<[string, string]> = [
    ['src/app/page.tsx', 'page'],
    ['.env.example', 'TEMPLATE=1'],
    ['.env.local', 'SECRET=1'],
    ['.next/static/x.js', 'x'],
    ['node_modules/pkg/index.js', 'x'],
    ['state/hermes.db', 'x'],
    ['.tmp/e2e-state/hermes.db', 'x'],
    ['test-results/r.json', 'x'],
  ];
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }

  const out = path.join(tempDir, 'export-out');
  templateExport.exportTemplate(root, out);

  assert.equal(existsSync(path.join(out, 'src', 'app', 'page.tsx')), true);
  assert.equal(existsSync(path.join(out, '.env.example')), true);
  for (const rel of ['.env.local', '.next/static/x.js', 'node_modules/pkg/index.js', 'state/hermes.db', '.tmp/e2e-state/hermes.db', 'test-results/r.json']) {
    assert.equal(existsSync(path.join(out, rel)), false, `${rel} must not ship`);
  }
});

test('exportTemplate refuses an output inside the source tree (#107)', () => {
  const root = path.join(tempDir, 'export-src');
  assert.throws(() => templateExport.exportTemplate(root, path.join(root, 'sub')), /source tree/);
  assert.throws(() => templateExport.exportTemplate(root, root), /source tree/);
});
