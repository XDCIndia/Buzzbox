import fs from 'fs';
import path from 'path';

import { getHermesStateDir } from '@/lib/hermes-state';

type JsonRow = Record<string, unknown>;
type WrappedArray = { leads: JsonRow[] } & Record<string, unknown>;

function getStateDir(): string {
  return getHermesStateDir();
}

function safeReadJson(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function getArrayContainer(
  data: unknown,
): { kind: 'array'; arr: JsonRow[] } | { kind: 'wrapped'; obj: WrappedArray; arr: JsonRow[] } | null {
  if (Array.isArray(data)) return { kind: 'array', arr: data as JsonRow[] };
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const leads = obj.leads;
  if (!Array.isArray(leads)) return null;
  return { kind: 'wrapped', obj: obj as WrappedArray, arr: leads as JsonRow[] };
}

/**
 * Write a status change back to a JSON state file so the Hermes agent picks it up.
 * Reads the file, finds the item by id, updates the status, writes back.
 * Silently no-ops if the file doesn't exist (local dev without state files).
 */
function updateJsonFile(
  filename: string,
  id: string,
  updates: Record<string, unknown>,
) {
  try {
    const filePath = path.join(getStateDir(), filename);
    if (!fs.existsSync(filePath)) return;
    const data = safeReadJson(filePath);
    const container = getArrayContainer(data);
    if (!container) return;
    const item = container.arr.find((d) => d?.id === id);
    if (!item) return;
    Object.assign(item, updates);
    if (container.kind === 'array') atomicWriteJson(filePath, container.arr);
    else atomicWriteJson(filePath, { ...container.obj, leads: container.arr });
  } catch {
    // Silently fail — state files may not exist in local dev
  }
}

function appendJsonFile(filename: string, row: Record<string, unknown>): void {
  const filePath = path.join(getStateDir(), filename);
  try {
    if (!fs.existsSync(filePath)) {
      atomicWriteJson(filePath, [row]);
      return;
    }
    const container = getArrayContainer(safeReadJson(filePath));
    // A present-but-unreadable file is operator data in an unknown state:
    // never replace it with a single row -- refuse and leave it for the
    // operator to repair (#148).
    if (!container) {
      console.warn(`[writeback] Refusing to overwrite unreadable state file: ${filePath}`);
      return;
    }

    const id = row.id;
    const idx = container.arr.findIndex((d) => d?.id === id);
    if (idx >= 0) {
      container.arr[idx] = { ...container.arr[idx], ...row };
    } else {
      container.arr.unshift(row);
    }

    if (container.kind === 'array') atomicWriteJson(filePath, container.arr);
    else atomicWriteJson(filePath, { ...container.obj, leads: container.arr });
  } catch {
    // ignore
  }
}

function deleteFromJsonFile(filename: string, id: string): void {
  const filePath = path.join(getStateDir(), filename);
  try {
    if (!fs.existsSync(filePath)) return;
    const data = safeReadJson(filePath);
    const container = getArrayContainer(data);
    if (!container) return;
    const next = container.arr.filter((d) => d?.id !== id);
    if (container.kind === 'array') atomicWriteJson(filePath, next);
    else atomicWriteJson(filePath, { ...container.obj, leads: next });
  } catch {
    // ignore
  }
}

/** Update content status in content-queue.json */
export function writebackContentStatus(id: string, status: string) {
  updateJsonFile('content-queue.json', id, { status });
}

/** Update sequence/email draft status in sequences.json */
export function writebackSequenceStatus(id: string, status: string) {
  updateJsonFile('sequences.json', id, { status });
}

/** Update lead status in leads.json */
export function writebackLeadStatus(id: string, status: string) {
  updateJsonFile('leads.json', id, { status });
}

/** Update arbitrary lead fields in leads.json */
export function writebackLeadUpdate(id: string, updates: Record<string, unknown>) {
  updateJsonFile('leads.json', id, updates);
}

/** Append or upsert a lead into leads.json */
export function writebackLeadCreate(lead: Record<string, unknown>) {
  appendJsonFile('leads.json', lead);
}

/** Remove a lead from leads.json */
export function writebackLeadDelete(id: string) {
  deleteFromJsonFile('leads.json', id);
}
