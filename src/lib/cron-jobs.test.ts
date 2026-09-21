import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  normalizeJobId,
  readCronJobsFile,
  toggleCronJob,
  triggerCronJobNow,
  upsertCronJob,
  writeCronJobsFile,
  mutateCronJobsFile,
} from './cron-jobs';

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-cron-jobs-test-'));

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('normalizeJobId accepts simple ids and rejects traversal/weird ids', () => {
  assert.equal(normalizeJobId('morning-research'), 'morning-research');
  assert.equal(normalizeJobId('A_1'), 'A_1');
  assert.equal(normalizeJobId(''), null);
  assert.equal(normalizeJobId('../x'), null);
  assert.equal(normalizeJobId('x y'), null);
});

test('readCronJobsFile returns empty list when jobs.json is missing', async () => {
  const cronDir = path.join(tempDir, 'cron-missing');
  const file = await readCronJobsFile(cronDir);
  assert.ok(file);
  assert.equal(Array.isArray(file.jobs), true);
  assert.equal(file.jobs.length, 0);
});

test('toggleCronJob flips enabled and triggerCronJobNow sets state.nextRunAtMs', async () => {
  const cronDir = path.join(tempDir, 'cron-basic');
  await fs.mkdir(cronDir, { recursive: true });
  await fs.writeFile(
    path.join(cronDir, 'jobs.json'),
    JSON.stringify({ version: 1, jobs: [{ id: 'a', enabled: true, state: { nextRunAtMs: 123 } }] }, null, 2),
    'utf-8',
  );

  const file = await readCronJobsFile(cronDir);
  const toggled = toggleCronJob(file, 'a');
  assert.ok(toggled);
  assert.equal(toggled.jobs[0].enabled, false);

  const triggered = triggerCronJobNow(toggled, 'a');
  assert.ok(triggered);
  assert.ok(triggered.jobs[0].state && typeof triggered.jobs[0].state === 'object');
  const nextRun = (triggered.jobs[0].state as Record<string, unknown>).nextRunAtMs;
  assert.equal(typeof nextRun, 'number');
  assert.ok((nextRun as number) > 0);
});

test('writeCronJobsFile writes jobs.json and creates backups when overwriting', async () => {
  const cronDir = path.join(tempDir, 'cron-write');
  await fs.mkdir(cronDir, { recursive: true });
  await fs.writeFile(path.join(cronDir, 'jobs.json'), JSON.stringify({ version: 1, jobs: [] }, null, 2), 'utf-8');

  const next = upsertCronJob({ version: 1, jobs: [] }, { id: 'job-1', enabled: true });
  await writeCronJobsFile(cronDir, next);

  const raw = await fs.readFile(path.join(cronDir, 'jobs.json'), 'utf-8');
  assert.match(raw, /"id": "job-1"/);
  const bak = await fs.readFile(path.join(cronDir, 'jobs.json.bak'), 'utf-8');
  assert.ok(bak.includes('"jobs"'));
});

test('readCronJobsFile normalizes legacy id and canonical jobId fields', async () => {
  const cronDir = path.join(tempDir, 'cron-normalize');
  await fs.mkdir(cronDir, { recursive: true });
  await fs.writeFile(
    path.join(cronDir, 'jobs.json'),
    JSON.stringify({
      version: 1,
      jobs: [
        { id: 'legacy-id', enabled: true },
        { jobId: 'canonical-id', enabled: true },
      ],
    }, null, 2),
    'utf-8',
  );

  const file = await readCronJobsFile(cronDir);
  assert.equal(file.jobs.length, 2);
  assert.equal(file.jobs[0].id, 'legacy-id');
  assert.equal(file.jobs[0].jobId, 'legacy-id');
  assert.equal(file.jobs[1].id, 'canonical-id');
  assert.equal(file.jobs[1].jobId, 'canonical-id');
});

test('upsert/toggle/trigger/delete support jobId-only records', async () => {
  const base = {
    version: 1,
    jobs: [{ jobId: 'job-a', enabled: true }],
  };

  const upserted = upsertCronJob(base, { jobId: 'job-b', enabled: true });
  assert.equal(upserted.jobs.length, 2);
  const jobB = upserted.jobs.find((job) => job.id === 'job-b');
  assert.ok(jobB);
  assert.equal(jobB.jobId, 'job-b');

  const toggled = toggleCronJob(upserted, 'job-a');
  assert.ok(toggled);
  const jobAAfterToggle = toggled.jobs.find((job) => job.id === 'job-a');
  assert.ok(jobAAfterToggle);
  assert.equal(jobAAfterToggle.enabled, false);

  const triggered = triggerCronJobNow(toggled, 'job-a');
  assert.ok(triggered);
  const jobAAfterTrigger = triggered.jobs.find((job) => job.id === 'job-a');
  assert.ok(jobAAfterTrigger);
  const nextRun = jobAAfterTrigger.state && (jobAAfterTrigger.state as Record<string, unknown>).nextRunAtMs;
  assert.equal(typeof nextRun, 'number');
});

test('cron schedule and delivery fields are preserved for OpenClaw compatibility', async () => {
  const jobsFile = {
    version: 1,
    jobs: [],
  };

  const next = upsertCronJob(jobsFile, {
    jobId: 'compat-job',
    enabled: true,
    schedule: {
      kind: 'cron',
      expr: '0 9 * * 1-5',
      tz: 'UTC',
      staggerMs: 15_000,
    },
    delivery: {
      mode: 'session_message',
      sessionId: 'sess_123',
    },
  });

  const job = next.jobs.find((item) => item.id === 'compat-job');
  assert.ok(job);
  assert.equal((job.schedule as Record<string, unknown>)?.staggerMs, 15_000);
  assert.equal((job.delivery as Record<string, unknown>)?.mode, 'session_message');
});

test('mutateCronJobsFile serializes concurrent mutations', async () => {
  const cronDir = path.join(tempDir, 'cron-concurrent');
  await fs.mkdir(cronDir, { recursive: true });

  await fs.writeFile(
    path.join(cronDir, 'jobs.json'),
    JSON.stringify({ version: 1, jobs: [] }, null, 2),
    'utf-8',
  );

  const results = await Promise.all([
    mutateCronJobsFile(cronDir, (jobsFile) =>
      upsertCronJob(jobsFile, {
        id: 'concurrent-a',
        enabled: true,
      }),
    ),
    mutateCronJobsFile(cronDir, (jobsFile) =>
      upsertCronJob(jobsFile, {
        id: 'concurrent-b',
        enabled: true,
      }),
    ),
  ]);

  assert.ok(results[0]);
  assert.ok(results[1]);

  const final = await readCronJobsFile(cronDir);
  const ids = final.jobs.map((job) => job.id);

  assert.deepEqual(ids.sort(), ['concurrent-a', 'concurrent-b']);
});