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

  // Avoid hidden directories and common sensitive files.
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return false;
  if (segments.some((s) => s.toLowerCase() === 'node_modules')) return false;
  if (segments.some((s) => s.toLowerCase() === 'state')) return false;
  if (segments.some((s) => s.toLowerCase() === 'credentials')) return false;
  if (segments.some((s) => s.toLowerCase() === 'logs')) return false;

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

