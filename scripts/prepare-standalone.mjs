#!/usr/bin/env node
/**
 * Ensure the Next.js standalone bundle has the latest static/public assets
 * before boot. Node implementation of prepare-standalone.sh (kept as a thin
 * wrapper for POSIX flows): rsync is not available on stock Windows, and
 * postbuild must run there because `pnpm build` invokes it (#107).
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function prepareStandalone(
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
) {
  const staticSrc = path.join(rootDir, '.next', 'static');
  const staticDest = path.join(rootDir, '.next', 'standalone', '.next', 'static');
  if (existsSync(staticSrc)) {
    mkdirSync(staticDest, { recursive: true });
    cpSync(staticSrc, staticDest, { recursive: true });
  }

  const publicSrc = path.join(rootDir, 'public');
  const publicDest = path.join(rootDir, '.next', 'standalone', 'public');
  if (existsSync(publicSrc)) {
    mkdirSync(publicDest, { recursive: true });
    cpSync(publicSrc, publicDest, { recursive: true });
  }
}

const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) prepareStandalone();
