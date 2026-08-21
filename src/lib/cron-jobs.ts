import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';

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
  try {
    const raw = await fs.readFile(jobsPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
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
  } catch {
    // ignore
  }
  return { version: 1, jobs: [] };
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp.${Date.now()}`);
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
}

export function normalizeJobId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  if (!id) return null;
  if (id.length > 128) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null;
  return id;
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
