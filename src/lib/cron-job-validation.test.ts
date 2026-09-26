import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MAX_CRON_JOB_JSON_BYTES,
  validateCronJobInput,
} from './cron-jobs';

/* Regression tests for issue #105: POST/PATCH /api/cron/jobs persisted
 * body.job verbatim (only the id was checked), letting any editor store
 * arbitrary schedules, payloads, and skills for the agent runner.
 * validateCronJobInput is pure -- no database or filesystem needed. */

const validJob = {
  id: 'morning-research',
  agentId: 'hermes',
  name: 'Morning research',
  enabled: true,
  schedule: { kind: 'cron', expr: '0 9 * * 1-5', tz: 'UTC' },
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payload: { kind: 'agentTurn', message: 'Do research.' },
  delivery: { mode: 'none' },
  skill: 'custom',
};

test('valid UI-shaped job passes with canonical id (#105)', () => {
  const res = validateCronJobInput(validJob);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.id, 'morning-research');
    assert.equal(res.job.name, 'Morning research');
  }
});

test('unknown top-level keys are stripped, not stored (#105)', () => {
  const res = validateCronJobInput({ ...validJob, evil: 'payload', nested: { deep: true } });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(!('evil' in res.job));
    assert.ok(!('nested' in res.job));
  }
});

test('missing or invalid id is rejected (#105)', () => {
  assert.deepEqual(validateCronJobInput(undefined), { ok: false, error: 'Invalid job: expected an object' });
  assert.deepEqual(validateCronJobInput({ name: 'no id' }), { ok: false, error: 'Invalid job.id' });
  assert.deepEqual(validateCronJobInput({ ...validJob, id: '../escape' }), { ok: false, error: 'Invalid job.id' });
});

test('oversized payload message is rejected (#105)', () => {
  const res = validateCronJobInput({
    ...validJob,
    payload: { kind: 'agentTurn', message: 'x'.repeat(33 * 1024) },
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /payload/);
});

test('total object over the byte cap is rejected (#105)', () => {
  const res = validateCronJobInput({ ...validJob, payload: { message: 'x'.repeat(MAX_CRON_JOB_JSON_BYTES) } });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /exceeds/);
});

test('malformed schedule expression is rejected (#105)', () => {
  const res = validateCronJobInput({ ...validJob, schedule: { kind: 'cron', expr: 'now; rm -rf ~' } });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /schedule\.expr/);
});

test('oversized skill and wrong types are rejected (#105)', () => {
  const longSkill = validateCronJobInput({ ...validJob, skill: 's'.repeat(200) });
  assert.equal(longSkill.ok, false);

  const badEnabled = validateCronJobInput({ ...validJob, enabled: 'yes' });
  assert.equal(badEnabled.ok, false);

  const badEvery = validateCronJobInput({ ...validJob, schedule: { everyMs: -5 } });
  assert.equal(badEvery.ok, false);
});

test('system-managed numeric fields pass through when well-formed (#105)', () => {
  const res = validateCronJobInput({ ...validJob, createdAtMs: 1727000000000, updatedAtMs: 1727000000000 });
  assert.equal(res.ok, true);
});

/* Route wiring: an oversized injection must 400 before any filesystem
 * access (no jobs.json is created). Mirrors the cron-runs.test.ts setup:
 * temp OpenClaw home, editor session, cron writes enabled. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-cron-validation-test-'));
const dbPath = path.join(tempDir, 'hermes-test.db');
const openclawHome = path.join(tempDir, 'openclaw-home');

process.env.HERMES_DB_PATH = dbPath;
process.env.HERMES_STATE_DIR = tempDir;
process.env.AUTH_USER = 'admin_test';
process.env.AUTH_PASS = 'super-secure-pass';
process.env.API_KEY = 'test-api-key';
process.env.HERMES_OPENCLAW_HOME = openclawHome;
process.env.HERMES_ALLOW_CRON_WRITE = 'true';

type DbModule = typeof import('./db');
type AuthModule = typeof import('./auth');
let dbm: DbModule;
let authm: AuthModule;
let jobsPost: typeof import('../app/api/cron/jobs/route')['POST'];
let editorCookie: string;

async function imp<T>(specifier: string): Promise<T> {
  const m = (await import(specifier)) as { default?: T };
  return (m.default ?? (m as unknown as T)) as T;
}

before(async () => {
  dbm = await imp<DbModule>('./db');
  authm = await imp<AuthModule>('./auth');
  jobsPost = (await imp<typeof import('../app/api/cron/jobs/route')>('../app/api/cron/jobs/route')).POST;

  authm.ensureAuthTables();
  dbm.getDb().exec("DELETE FROM sessions; DELETE FROM users WHERE username = 'cronval_editor';");
  const editor = authm.createUser('cronval_editor', 'editor-password-123', 'editor');
  editorCookie = `hermes-session=${authm.createSession(editor.id)}`;
});

after(() => {
  dbm.resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

function postJob(job: unknown): Promise<Response> {
  const req = new Request('http://localhost/api/cron/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: editorCookie },
    body: JSON.stringify({ job }),
  });
  return jobsPost(req as never);
}

test('POST /api/cron/jobs answers 400 on injected payload without touching disk (#105)', async () => {
  const res = await postJob({
    ...validJob,
    payload: { kind: 'agentTurn', message: 'x'.repeat(40 * 1024) },
    skill: 'custom"; DROP TABLE jobs; --',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(String(body.error), /Invalid job/);

  // Validation runs before any filesystem access: no jobs.json was created.
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(path.join(openclawHome, 'cron', 'jobs.json')), false);
});
