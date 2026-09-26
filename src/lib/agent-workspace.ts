import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getAgentWorkspaceRoot(): string {
  const configured = process.env.HERMES_AGENT_WORKSPACE_DIR?.trim();
  const fallback = path.join(os.homedir(), 'workspace');
  return path.resolve(configured || fallback);
}

export const WORKSPACE_MAX_FILE_BYTES = 512 * 1024;

const ALLOWED_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.csv',
  '.tsv',
  '.toml',
]);

export function isAllowedWorkspaceWritePath(relPath: string): boolean {
  const p = String(relPath || '').trim();
  if (!p) return false;
  if (p.includes('\0')) return false;
  if (path.isAbsolute(p)) return false;

  // Normalize to prevent path traversal.
  const normalized = path.posix.normalize(p.replaceAll('\\', '/'));
  if (normalized.startsWith('../') || normalized === '..') return false;

  // Avoid hidden directories and common sensitive files. Mirrors the
  // HIDDEN_DIR_NAMES policy enforced on listings/reads in the workspace
  // API route, so hidden trees are neither listed, read, nor written (#106).
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return false;
  if (segments.some((s) => s.toLowerCase() === 'node_modules')) return false;
  if (segments.some((s) => s.toLowerCase() === 'state')) return false;
  if (segments.some((s) => s.toLowerCase() === 'credentials')) return false;
  if (segments.some((s) => s.toLowerCase() === 'logs')) return false;
  if (segments.some((s) => s.toLowerCase() === 'sessions')) return false;
  if (segments.some((s) => s.toLowerCase() === 'sandboxes')) return false;
  if (segments.some((s) => s.toLowerCase() === 'sandbox')) return false;

  const ext = path.posix.extname(normalized).toLowerCase();
  return ALLOWED_EXTS.has(ext);
}

export function normalizeWorkspaceRelativePath(relPath: string): string | null {
  const p = String(relPath || '').trim();
  if (!p) return null;
  if (p.includes('\0')) return null;
  if (path.isAbsolute(p)) return null;

  const normalized = path.posix.normalize(p.replaceAll('\\', '/'));
  if (normalized.startsWith('../') || normalized === '..') return null;
  return normalized;
}

export function resolveWorkspacePath(root: string, relPath: string): string | null {
  const normalized = normalizeWorkspaceRelativePath(relPath);
  if (!normalized) return null;

  // Use platform path.resolve and then enforce root prefix.
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (resolved === rootResolved) return null;
  if (!resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

function isInsideOrEqual(rootResolved: string, candidate: string): boolean {
  return candidate === rootResolved || candidate.startsWith(rootResolved + path.sep);
}

/** Resolve a workspace-relative path to its real (symlink-free) absolute
 * path, enforcing containment inside the real root.
 *
 * `path.resolve` prefix checks alone are bypassed by a symlink planted
 * inside the root that points outside it (#106). This resolves the nearest
 * existing ancestor (so paths for files about to be created work too) and
 * re-checks containment on the real paths. Returns null for malformed
 * paths, missing roots, and anything escaping the root. */
export async function resolveWorkspaceRealPath(rootDir: string, relPath: string): Promise<string | null> {
  const prelim = resolveWorkspacePath(rootDir, relPath);
  if (!prelim) return null;
  const rootResolved = path.resolve(rootDir);

  // Walk up to the nearest existing ancestor so not-yet-created files
  // resolve through any symlinked parent directories. The walk starts
  // inside the root, so reaching the root itself always terminates it.
  let existing = prelim;
  const rest: string[] = [];
  for (;;) {
    try {
      await fs.lstat(existing);
      break;
    } catch {
      if (existing === rootResolved) break;
      const parent = path.dirname(existing);
      if (parent === existing || !isInsideOrEqual(rootResolved, parent)) return null;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }

  let realRoot: string;
  let realExisting: string;
  try {
    realRoot = await fs.realpath(rootResolved);
    realExisting = await fs.realpath(existing);
  } catch {
    return null;
  }
  const realTarget = rest.length ? path.join(realExisting, ...rest) : realExisting;
  if (!isInsideOrEqual(realRoot, realTarget)) return null;
  return realTarget;
}

