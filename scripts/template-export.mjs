#!/usr/bin/env node
/**
 * Export a shareable project template: copies the repo while excluding
 * secrets, databases, build output, dependencies, and runtime/test
 * artifacts. Node implementation of template-export.sh (kept as a thin
 * wrapper for POSIX flows): rsync and /tmp paths are not available on
 * stock Windows (#107).
 *
 * Unlike the previous rsync filter set, .env.example is explicitly kept --
 * the old `--exclude ".env.*"` dropped the very file the next-steps message
 * told you to copy.
 */
import { cpSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDE_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'state',
  '.tmp',
  'test-results',
  'playwright-report',
  'coverage',
]);

const EXCLUDE_FILES = new Set(['hermes-seed-fix.bundle', '.eslintcache']);

/** True when a repo-relative posix path must not ship in the template. */
export function shouldExclude(relPosix) {
  const segments = relPosix.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.some((s) => EXCLUDE_DIRS.has(s))) return true;

  const base = segments[segments.length - 1];
  if (EXCLUDE_FILES.has(base)) return true;
  // SQLite databases and journals (./hermes.db, .db-wal, .db-shm, ...).
  if (/\.db($|[-.])/.test(base)) return true;
  // Secret environment files -- but keep the documented template.
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return true;
  return false;
}

export function defaultExportDir() {
  const ts = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  return path.join(os.tmpdir(), `hermes-dashboard-template-${ts}`);
}

/** Copy root into out honoring shouldExclude. Throws when out is missing,
 * equal to root, or inside root (which would recurse). */
export function exportTemplate(rootDir, outDir) {
  if (!outDir) throw new Error('exportTemplate requires an output directory');
  const root = path.resolve(rootDir);
  const out = path.resolve(outDir);
  if (out === root || out.startsWith(root + path.sep)) {
    throw new Error(`Refusing to export into the source tree: ${outDir}`);
  }
  const toRelPosix = (abs) => path.relative(root, abs).split(path.sep).join('/');
  cpSync(root, out, {
    recursive: true,
    filter: (src) => !shouldExclude(toRelPosix(src)),
  });
  return out;
}

function printNextSteps(out) {
  process.stdout.write(`Exported template to: ${out}\n`);
  process.stdout.write('Next steps:\n');
  process.stdout.write(`  cd ${out} && pnpm install && cp .env.example .env.local\n`);
}

const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = exportTemplate(root, process.argv[2] || defaultExportDir());
  if (!existsSync(path.join(out, '.env.example'))) {
    throw new Error('Export is missing .env.example -- refusing to print next steps');
  }
  printNextSteps(out);
}
