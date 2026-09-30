import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_COMMAND_OUTPUT_BYTES,
  runLeadsAdmin,
} from './command';

/* Regression tests for issue #151: runLeadsAdmin killed the child on
 * timeout but *resolved* with the truncated stdout as if successful, so
 * callers persisted hallucinated partial agent replies. Stdout/stderr also
 * grew unboundedly for the whole timeout window.
 *
 * Pure child-process tests via the injectable `bin` (this machine's own
 * node) -- no database, no network, cross-platform. */

const NODE = process.execPath;

test('timeout rejects instead of resolving partial output (#151)', async () => {
  await assert.rejects(
    () => runLeadsAdmin(['-e', 'setTimeout(() => {}, 30_000)'], { timeoutMs: 300, bin: NODE }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /timed out after 300ms/);
      assert.equal((err as { timedOut?: boolean }).timedOut, true);
      return true;
    },
  );
});

test('output is capped and flagged when a child is chatty (#151)', async () => {
  const result = await runLeadsAdmin(
    ['-e', 'process.stdout.write("x".repeat(1024 * 1024))'],
    { bin: NODE },
  );
  assert.ok(result.stdout.length <= MAX_COMMAND_OUTPUT_BYTES);
  assert.equal(result.truncated, true);
  assert.equal(result.timedOut, false);
});

test('well-behaved commands resolve with full output and flags clear (#151)', async () => {
  const result = await runLeadsAdmin(['-e', 'process.stdout.write("hello")'], { bin: NODE });
  assert.equal(result.stdout, 'hello');
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
});
