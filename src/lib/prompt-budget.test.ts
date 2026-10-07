import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PROMPT_JSON_CHARS,
  MAX_PROMPT_LIST_ITEMS,
  compactApprovalsForPrompt,
} from './prompt-budget';

/* Payload budgets for the approvals summary prompt (#203): lists are
 * sliced, long text truncated, and the total JSON is hard-capped, while
 * server-side totals stay exact so the model never undercounts. Pure
 * functions — no env or DB needed. */

function bigApprovals(contentN: number, seqN: number) {
  return {
    content: Array.from({ length: contentN }, (_, i) => ({
      id: `c${i}`,
      platform: 'x',
      format: 'short_post',
      text_preview: `preview ${i} `,
      full_content: 'B'.repeat(2000),
      status: 'pending_approval',
      scheduled_for: null,
      created_at: '2026-10-01',
      image_url: null,
    })),
    sequences: Array.from({ length: seqN }, (_, i) => ({
      id: `s${i}`,
      lead_id: `l${i}`,
      sequence_name: 'intro',
      step: 1,
      subject: `subject ${i} `,
      body: 'E'.repeat(3000),
      status: 'pending_approval',
      tier: 'A',
      created_at: '2026-10-01',
      first_name: 'Ada',
      last_name: 'L',
      company: 'Acme',
    })),
    total: contentN + seqN,
  };
}

test('busy queues are capped but totals stay exact', () => {
  const json = compactApprovalsForPrompt(bigApprovals(25, 15));
  const payload = JSON.parse(json) as {
    total: number;
    contentTotal: number;
    sequencesTotal: number;
    truncated: boolean;
    content: unknown[];
    sequences: unknown[];
  };
  assert.equal(payload.total, 40);
  assert.equal(payload.contentTotal, 25);
  assert.equal(payload.sequencesTotal, 15);
  assert.equal(payload.truncated, true);
  assert.ok(payload.content.length <= MAX_PROMPT_LIST_ITEMS);
  assert.ok(payload.sequences.length <= MAX_PROMPT_LIST_ITEMS);
  assert.ok(json.length <= MAX_PROMPT_JSON_CHARS, `payload must fit budget, got ${json.length}`);
  // Full bodies must not leak into the prompt.
  assert.ok(!json.includes('B'.repeat(200)), 'post bodies must be projected away');
  assert.ok(!json.includes('E'.repeat(200)), 'email bodies must be projected away');
});

test('small queues pass through untruncated', () => {
  const json = compactApprovalsForPrompt(bigApprovals(2, 1));
  const payload = JSON.parse(json) as { total: number; truncated: boolean; content: unknown[]; sequences: unknown[] };
  assert.equal(payload.total, 3);
  assert.equal(payload.truncated, false);
  assert.equal(payload.content.length, 2);
  assert.equal(payload.sequences.length, 1);
});

test('empty queues stay valid with zero totals', () => {
  const payload = JSON.parse(compactApprovalsForPrompt({ content: [], sequences: [], total: 0 })) as {
    total: number;
    truncated: boolean;
  };
  assert.equal(payload.total, 0);
  assert.equal(payload.truncated, false);
});
