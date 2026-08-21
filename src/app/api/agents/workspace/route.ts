import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { allowWorkspaceWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';
import {
  getAgentWorkspaceRoot,
  isAllowedWorkspaceWritePath,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath,
  WORKSPACE_MAX_FILE_BYTES,
} from '@/lib/agent-workspace';

export const dynamic = 'force-dynamic';

type Entry = {
  path: string; // relative, posix
  type: 'file' | 'dir';
  size?: number;
  mtimeMs?: number;
};

type RootKind = 'agent-workspace' | 'openclaw' | 'workspace' | 'agent';

type ResolvedRoot = {
  id: string;
  label: string;
  kind: RootKind;
  abs: string;
  writable: boolean;
};

function getInstanceIdFromRequest(req: NextRequest): string | null {
  try {
    const url = new URL(req.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

const HIDDEN_DIR_NAMES = new Set([
  'node_modules',
  'credentials',
  'state',
  'logs',
  'sessions',
  'sandboxes',
  'sandbox',
]);

function shouldHide(relPosix: string): boolean {
  const segments = relPosix.split('/').filter(Boolean);
  return segments.some((s) => {
    if (s.startsWith('.')) return true;
    // Windows strips trailing dots/spaces from path segments, so match
    // sensitive names ignoring them (e.g. "credentials." === "credentials").
    const name = s.replace(/[. ]+$/, '').toLowerCase();
    return HIDDEN_DIR_NAMES.has(name);
  });
}

async function listDir(root: string, relDir: string, depth: number, maxEntries: number): Promise<Entry[]> {
  const absDir = relDir ? resolveWorkspacePath(root, relDir) : root;
  if (!absDir) return [];

  const out: Entry[] = [];
  const queue: Array<{ abs: string; rel: string; d: number }> = [{ abs: absDir, rel: relDir, d: 0 }];

  while (queue.length > 0 && out.length < maxEntries) {
    const cur = queue.shift()!;
    let names: string[] = [];
    try {
      names = await fs.readdir(cur.abs);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name) continue;
      const abs = path.join(cur.abs, name);
      let st: import('node:fs').Stats | null = null;
      try {
        st = await fs.stat(abs);
      } catch {
        continue;
      }

      const rel = cur.rel ? `${cur.rel.replace(/\/+$/, '')}/${name}` : name;
      const relPosix = rel.split(path.sep).join('/');
      if (shouldHide(relPosix)) continue;

      if (st.isDirectory()) {
        out.push({ path: relPosix, type: 'dir', mtimeMs: st.mtimeMs });
        if (cur.d + 1 < depth) {
          queue.push({ abs, rel: relPosix, d: cur.d + 1 });
        }
      } else if (st.isFile()) {
        out.push({ path: relPosix, type: 'file', size: st.size, mtimeMs: st.mtimeMs });
      }

      if (out.length >= maxEntries) break;
    }
  }

  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return out;
}

async function writeFileAtomic(absPath: string, content: string): Promise<void> {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  const tmp = path.join(dir, `.${base}.tmp.${Date.now()}`);
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, absPath);
}

function resolveRootFromId(req: NextRequest, rootIdRaw: string | null | undefined): ResolvedRoot {
  const rootId = String(rootIdRaw ?? '').trim() || 'agent-workspace';

  if (rootId === 'agent-workspace') {
    return {
      id: rootId,
      label: 'Agent Workspace',
      kind: 'agent-workspace',
      abs: getAgentWorkspaceRoot(),
      writable: true,
    };
  }

  const instanceId = getInstanceIdFromRequest(req);
  const instance = getInstance(instanceId);
  const { openclawHome } = resolveOpenClawPaths(instance);
  const openclawResolved = path.resolve(openclawHome);

  if (rootId === 'openclaw') {
    return {
      id: rootId,
      label: '.openclaw',
      kind: 'openclaw',
      abs: openclawResolved,
      writable: false,
    };
  }

  if (rootId === 'shared' || /^workspace-[a-z0-9-]+$/i.test(rootId)) {
    const abs = path.resolve(openclawResolved, rootId);
    if (!abs.startsWith(openclawResolved + path.sep)) {
      throw new Error('Invalid root');
    }
    return {
      id: rootId,
      label: rootId === 'shared' ? 'Shared' : rootId,
      kind: 'workspace',
      abs,
      writable: true,
    };
  }

  if (rootId.startsWith('agent:')) {
    const name = rootId.slice('agent:'.length).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error('Invalid root');
    const abs = path.resolve(openclawResolved, 'agents', name, 'agent');
    if (!abs.startsWith(openclawResolved + path.sep)) {
      throw new Error('Invalid root');
    }
    return {
      id: rootId,
      label: `Agent: ${name}`,
      kind: 'agent',
      abs,
      writable: true,
    };
  }

  throw new Error('Unknown root');
}

async function assertDirExists(abs: string): Promise<void> {
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error('Root not found');
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;

  const rel = req.nextUrl.searchParams.get('path')?.trim() || '';

  try {
    const root = resolveRootFromId(req, req.nextUrl.searchParams.get('rootId'));
    await assertDirExists(root.abs);

    if (!rel) {
      const depth = root.kind === 'openclaw' ? 2 : 4;
      const entries = await listDir(root.abs, '', depth, 5000);
      return NextResponse.json({ rootId: root.id, rootLabel: root.label, kind: root.kind, writable: root.writable, entries });
    }

    const abs = resolveWorkspacePath(root.abs, rel);
    if (!abs) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

    // Direct reads must obey the same sensitive-path policy as listings.
    const relNormalized = normalizeWorkspaceRelativePath(rel);
    if (relNormalized && shouldHide(relNormalized)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const st = await fs.stat(abs).catch(() => null);
    if (!st) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (st.isDirectory()) {
      const entries = await listDir(root.abs, rel, 2, 5000);
      return NextResponse.json({ rootId: root.id, rootLabel: root.label, kind: root.kind, writable: root.writable, path: rel, entries });
    }

    if (!st.isFile()) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }
    if (st.size > WORKSPACE_MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
    }

    const content = await fs.readFile(abs, 'utf-8');
    return NextResponse.json({ rootId: root.id, rootLabel: root.label, kind: root.kind, writable: root.writable, path: rel, size: st.size, mtimeMs: st.mtimeMs, content });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowWorkspaceWrite()) {
    return NextResponse.json({ error: 'Workspace writes are disabled (set HERMES_ALLOW_WORKSPACE_WRITE=true)' }, { status: 403 });
  }

  const actor = requireUser(req as unknown as Request);
  const body = await req.json().catch(() => ({}));
  const rel = String(body?.path ?? '').trim();
  const content = String(body?.content ?? '');
  const rootId = String(body?.rootId ?? '').trim();

  if (!isAllowedWorkspaceWritePath(rel)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 400 });
  }
  if (Buffer.byteLength(content, 'utf-8') > WORKSPACE_MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 });
  }

  try {
    const root = resolveRootFromId(req, rootId);
    await assertDirExists(root.abs);
    if (!root.writable) {
      return NextResponse.json({ error: 'Root is read-only' }, { status: 403 });
    }

    const abs = resolveWorkspacePath(root.abs, rel);
    if (!abs) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');

    logAudit({
      actor,
      action: 'workspace.create',
      target: `workspace:${root.id}:${rel}`,
      detail: { bytes: Buffer.byteLength(content, 'utf-8') },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowWorkspaceWrite()) {
    return NextResponse.json({ error: 'Workspace writes are disabled (set HERMES_ALLOW_WORKSPACE_WRITE=true)' }, { status: 403 });
  }

  const actor = requireUser(req as unknown as Request);
  const body = await req.json().catch(() => ({}));
  const rel = String(body?.path ?? '').trim();
  const content = String(body?.content ?? '');
  const rootId = String(body?.rootId ?? '').trim();

  if (!isAllowedWorkspaceWritePath(rel)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 400 });
  }
  if (Buffer.byteLength(content, 'utf-8') > WORKSPACE_MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 });
  }

  try {
    const root = resolveRootFromId(req, rootId);
    await assertDirExists(root.abs);
    if (!root.writable) {
      return NextResponse.json({ error: 'Root is read-only' }, { status: 403 });
    }

    const abs = resolveWorkspacePath(root.abs, rel);
    if (!abs) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

    const st = await fs.stat(abs).catch(() => null);
    if (!st || !st.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const backup = `${abs}.bak.${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}`;
    await fs.copyFile(abs, backup).catch(() => null);

    await writeFileAtomic(abs, content);

    logAudit({
      actor,
      action: 'workspace.update',
      target: `workspace:${root.id}:${rel}`,
      detail: { bytes: Buffer.byteLength(content, 'utf-8') },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  if (!allowWorkspaceWrite()) {
    return NextResponse.json({ error: 'Workspace writes are disabled (set HERMES_ALLOW_WORKSPACE_WRITE=true)' }, { status: 403 });
  }

  const actor = requireUser(req as unknown as Request);
  const rel = req.nextUrl.searchParams.get('path')?.trim() || '';
  const rootId = req.nextUrl.searchParams.get('rootId')?.trim() || '';

  if (!isAllowedWorkspaceWritePath(rel)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 400 });
  }

  try {
    const root = resolveRootFromId(req, rootId);
    await assertDirExists(root.abs);
    if (!root.writable) {
      return NextResponse.json({ error: 'Root is read-only' }, { status: 403 });
    }

    const abs = resolveWorkspacePath(root.abs, rel);
    if (!abs) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });

    const st = await fs.stat(abs).catch(() => null);
    if (!st || !st.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await fs.unlink(abs);

    logAudit({
      actor,
      action: 'workspace.delete',
      target: `workspace:${root.id}:${rel}`,
      detail: null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
