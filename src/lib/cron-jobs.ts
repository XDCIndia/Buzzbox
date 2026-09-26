import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export type CronSchedule = {
  kind?: string;
  expr?: string;
  tz?: string;
  at?: string;
  everyMs?: number;
  staggerMs?: number;
};

export type CronJobConfig = {
  id?: string;
  jobId?: string;
  agentId?: string;
  name?: string;
  enabled?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule?: CronSchedule;
  sessionTarget?: string;
  wakeMode?: string;
  payload?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  skill?: string;
  state?: Record<string, unknown>;
  [k: string]: unknown;
};

export type CronJobsFile = {
  version?: number;
  jobs: CronJobConfig[];
  [k: string]: unknown;
};

export function getJobsPath(cronDir: string): string {
  return path.join(cronDir, 'jobs.json');
}

/** Thrown when jobs.json exists but is not parseable (or not an object).
 * Read callers must not fall back to an empty schedule: the next mutation
 * would overwrite the corrupt file and permanently delete the operator's
 * schedules (#104). */
export class CronJobsCorruptError extends Error {
  readonly jobsPath: string;
  constructor(jobsPath: string) {
    super(
      `Cron jobs file is corrupt and was left untouched: ${jobsPath}. Quarantine or repair it (POST /api/cron/jobs/reset) before mutating schedules.`,
    );
    this.name = 'CronJobsCorruptError';
    this.jobsPath = jobsPath;
  }
}

/** Maximum retained timestamped backups (`jobs.json.bak.*`). The stable
 * `jobs.json.bak` is always kept and never counts toward this limit. */
export const MAX_CRON_BACKUPS = 10;

export function getCronRunsDir(cronDir: string): string {
  return path.join(path.resolve(cronDir), 'runs');
}

export function isPathInsideDir(rootDir: string, candidate: string): boolean {
  const rootResolved = path.resolve(rootDir);
  const candidateResolved = path.resolve(candidate);
  if (candidateResolved === rootResolved) return false;
  return candidateResolved.startsWith(rootResolved + path.sep);
}

export function resolveCronRunFilePath(cronDir: string, rawId: unknown): string | null {
  const id = normalizeJobId(rawId);
  if (!id) return null;
  const runsDir = getCronRunsDir(cronDir);
  const file = path.resolve(runsDir, `${id}.jsonl`);
  if (!isPathInsideDir(runsDir, file)) return null;
  return file;
}

function resolveCronJobId(job: CronJobConfig): string | null {
  return normalizeJobId(job.id ?? job.jobId);
}

function normalizeCronJobRecord(job: CronJobConfig): CronJobConfig {
  const jobId = resolveCronJobId(job);
  if (!jobId) return job;
  return { ...job, id: jobId, jobId };
}

export async function readCronJobsFile(cronDir: string): Promise<CronJobsFile> {
  const jobsPath = getJobsPath(cronDir);
  let raw: string;
  try {
    raw = await fs.readFile(jobsPath, 'utf-8');
  } catch (err) {
    // A missing file simply means "no schedules yet".
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { version: 1, jobs: [] };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CronJobsCorruptError(jobsPath);
  }
  if (Array.isArray(parsed)) {
    const jobs = (parsed as CronJobConfig[]).map(normalizeCronJobRecord);
    return { version: 1, jobs };
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as { version?: unknown; jobs?: unknown };
    const jobs = Array.isArray(obj.jobs)
      ? (obj.jobs as CronJobConfig[]).map(normalizeCronJobRecord)
      : [];
    const version = typeof obj.version === 'number' ? obj.version : 1;
    return { ...(parsed as Record<string, unknown>), version, jobs };
  }
  throw new CronJobsCorruptError(jobsPath);
}

type CronMutation = (jobsFile: CronJobsFile) => CronJobsFile | null;

const cronMutationLocks = new Map<string, Promise<void>>();

export async function mutateCronJobsFile(
  cronDir: string,
  mutation: CronMutation,
): Promise<CronJobsFile | null> {
  const previous = cronMutationLocks.get(cronDir) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  const queued = previous.then(() => current);
  cronMutationLocks.set(cronDir, queued);

  await previous;

  try {
    // readCronJobsFile throws CronJobsCorruptError on unparseable input, so
    // a mutation can never silently build on an empty schedule and wipe the
    // operator's jobs on write (#104).
    const jobsFile = await readCronJobsFile(cronDir);
    const next = mutation(jobsFile);

    if (next) {
      await writeCronJobsFile(cronDir, next);
    }

    return next;
  } finally {
    release();

    if (cronMutationLocks.get(cronDir) === queued) {
      cronMutationLocks.delete(cronDir);
    }
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(
  dir,
  `.${base}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, filePath);
}

export async function writeCronJobsFile(cronDir: string, next: CronJobsFile): Promise<void> {
  const jobsPath = getJobsPath(cronDir);
  const nowIso = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');

  // Keep a stable backup alongside the file.
  if (fsSync.existsSync(jobsPath)) {
    await fs.copyFile(jobsPath, path.join(cronDir, 'jobs.json.bak')).catch(() => null);
    await fs.copyFile(jobsPath, path.join(cronDir, `jobs.json.bak.${nowIso}`)).catch(() => null);
  }

  await fs.mkdir(cronDir, { recursive: true });
  await writeJsonAtomic(jobsPath, next);
  await pruneCronBackups(cronDir);
}

/** Drops old timestamped backups beyond MAX_CRON_BACKUPS (newest kept).
 * The stable `jobs.json.bak` is never touched. Best-effort: a missing or
 * unreadable directory is not an error. */
export async function pruneCronBackups(cronDir: string, keep: number = MAX_CRON_BACKUPS): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(cronDir);
  } catch {
    return;
  }
  const stamped = entries
    .filter((name) => name.startsWith('jobs.json.bak.'))
    .sort()
    .reverse();
  for (const name of stamped.slice(keep)) {
    await fs.unlink(path.join(cronDir, name)).catch(() => null);
  }
}

/** Moves a corrupt jobs.json aside (`jobs.json.corrupt.<timestamp>.<rand>`,
 * never pruned) and writes a fresh empty schedule. Returns null when there
 * is nothing to reset (missing file, or a valid schedule). Operators invoke
 * this explicitly via POST /api/cron/jobs/reset -- it never runs implicitly,
 * so no code path can surprise-wipe schedules (#104). */
export async function resetCorruptJobsFile(cronDir: string): Promise<{ quarantined: string } | null> {
  const jobsPath = getJobsPath(cronDir);
  let raw: string;
  try {
    raw = await fs.readFile(jobsPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
  let corrupt = false;
  try {
    const parsed: unknown = JSON.parse(raw);
    corrupt = !parsed || typeof parsed !== 'object';
  } catch {
    corrupt = true;
  }
  if (!corrupt) return null;

  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const rand = Math.random().toString(36).slice(2, 8);
  const name = `jobs.json.corrupt.${stamp}.${rand}`;
  await fs.mkdir(cronDir, { recursive: true });
  await fs.rename(jobsPath, path.join(cronDir, name));
  await writeJsonAtomic(jobsPath, { version: 1, jobs: [] });
  return { quarantined: name };
}

export function normalizeJobId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  if (!id) return null;
  if (id.length > 128) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null;
  return id;
}

// ─── Job input validation (#105) ─────────────────────────────
// POST/PATCH /api/cron/jobs used to persist body.job verbatim (only the id
// was checked), letting any editor store arbitrary schedules, payloads, and
// skills for the agent runner to execute. Submitted jobs must match the
// contract below: known fields are validated and size-capped, unknown keys
// are stripped (zod default), and the whole object is byte-capped like
// cron templates (MAX_JOB_JSON_BYTES in cron-templates.ts).

export const MAX_CRON_JOB_JSON_BYTES = 128 * 1024;
const MAX_JOB_NAME = 80;
const MAX_JOB_SHORT_STRING = 128;
const MAX_JOB_PAYLOAD_BYTES = 32 * 1024;
const MAX_JOB_SMALL_RECORD_BYTES = 8 * 1024;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function cappedRecord(maxBytes: number) {
  return z.record(z.string(), z.unknown()).refine(
    (v) => byteLength(v) <= maxBytes,
    { message: `object exceeds ${maxBytes} bytes` },
  );
}

const cronScheduleSchema = z.object({
  kind: z.string().max(32).optional(),
  expr: z.string().max(64).regex(/^[0-9*,/\sA-Za-z-]+$/, 'Invalid schedule expression').optional(),
  tz: z.string().max(64).optional(),
  at: z.string().max(64).optional(),
  everyMs: z.number().int().positive().max(365 * 24 * 3600 * 1000).optional(),
  staggerMs: z.number().int().min(0).max(3600 * 1000).optional(),
});

const cronJobInputSchema = z.object({
  id: z.unknown().optional(),
  jobId: z.unknown().optional(),
  agentId: z.string().max(MAX_JOB_SHORT_STRING).optional(),
  name: z.string().max(MAX_JOB_NAME).optional(),
  enabled: z.boolean().optional(),
  createdAtMs: z.number().int().nonnegative().optional(),
  updatedAtMs: z.number().int().nonnegative().optional(),
  schedule: cronScheduleSchema.optional(),
  sessionTarget: z.string().max(MAX_JOB_SHORT_STRING).optional(),
  wakeMode: z.string().max(MAX_JOB_SHORT_STRING).optional(),
  payload: cappedRecord(MAX_JOB_PAYLOAD_BYTES).optional(),
  delivery: cappedRecord(MAX_JOB_SMALL_RECORD_BYTES).optional(),
  skill: z.string().max(MAX_JOB_SHORT_STRING).optional(),
  state: cappedRecord(MAX_JOB_SMALL_RECORD_BYTES).optional(),
});

export type CronJobValidation =
  | { ok: true; job: CronJobConfig; id: string }
  | { ok: false; error: string };

/** Validates a submitted job body (after derived-field stripping). Returns
 * the stripped, normalized job plus its canonical id, or a 400-ready error. */
export function validateCronJobInput(rawJob: unknown): CronJobValidation {
  if (!rawJob || typeof rawJob !== 'object' || Array.isArray(rawJob)) {
    return { ok: false, error: 'Invalid job: expected an object' };
  }
  if (byteLength(rawJob) > MAX_CRON_JOB_JSON_BYTES) {
    return { ok: false, error: `Invalid job: exceeds ${MAX_CRON_JOB_JSON_BYTES} bytes` };
  }
  const parsed = cronJobInputSchema.safeParse(rawJob);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? ` (${first.path.join('.')})` : '';
    return { ok: false, error: `Invalid job${where}: ${first.message}` };
  }
  const id = normalizeJobId(parsed.data.id ?? parsed.data.jobId);
  if (!id) return { ok: false, error: 'Invalid job.id' };
  return { ok: true, job: parsed.data as CronJobConfig, id };
}

export function upsertCronJob(jobsFile: CronJobsFile, job: CronJobConfig): CronJobsFile {
  const jobId = resolveCronJobId(job);
  if (!jobId) return jobsFile;

  const normalizedJob = normalizeCronJobRecord(job);
  const now = Date.now();
  const existing = jobsFile.jobs.find((j) => resolveCronJobId(j) === jobId);
  if (existing) {
    const existingId = resolveCronJobId(existing);
    if (!existingId) return jobsFile;
    const merged = normalizeCronJobRecord({
      ...existing,
      ...normalizedJob,
      id: existingId,
      updatedAtMs: now,
    });
    return {
      ...jobsFile,
      jobs: jobsFile.jobs.map((j) => (resolveCronJobId(j) === existingId ? merged : j)),
    };
  }
  const next = {
    ...normalizedJob,
    id: jobId,
    jobId,
    enabled: normalizedJob.enabled !== false,
    createdAtMs: typeof normalizedJob.createdAtMs === 'number' ? normalizedJob.createdAtMs : now,
    updatedAtMs: now,
  };
  return { ...jobsFile, jobs: [...jobsFile.jobs, next] };
}

export function deleteCronJob(jobsFile: CronJobsFile, id: string): CronJobsFile {
  return { ...jobsFile, jobs: jobsFile.jobs.filter((j) => resolveCronJobId(j) !== id) };
}

export function toggleCronJob(jobsFile: CronJobsFile, id: string): CronJobsFile | null {
  const found = jobsFile.jobs.find((j) => resolveCronJobId(j) === id);
  if (!found) return null;
  const now = Date.now();
  const enabled = found.enabled === false;
  const next = normalizeCronJobRecord({ ...found, enabled, updatedAtMs: now });
  return {
    ...jobsFile,
    jobs: jobsFile.jobs.map((j) => (resolveCronJobId(j) === id ? next : j)),
  };
}

export function triggerCronJobNow(jobsFile: CronJobsFile, id: string): CronJobsFile | null {
  const found = jobsFile.jobs.find((j) => resolveCronJobId(j) === id);
  if (!found) return null;

  // Best-effort "run now": bump nextRunAtMs to now.
  const now = Date.now();
  const state = (typeof found.state === 'object' && found.state !== null) ? (found.state as Record<string, unknown>) : {};
  const nextState = { ...state, nextRunAtMs: now };
  const next = normalizeCronJobRecord({ ...found, state: nextState, updatedAtMs: now });
  return {
    ...jobsFile,
    jobs: jobsFile.jobs.map((j) => (resolveCronJobId(j) === id ? next : j)),
  };
}
