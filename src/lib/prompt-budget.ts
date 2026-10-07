/**
 * Prompt payload budgets (#203): the approvals summary prompt used to embed
 * full unbounded DB rows (including whole post bodies and email bodies), so a
 * busy pending queue could overflow small context windows on its own. These
 * helpers slice lists, project summary fields, truncate long text, and
 * enforce a total character budget. Totals are computed server-side FIRST, so
 * truncation never corrupts counts (the model is told to report the totals).
 */

export const MAX_PROMPT_LIST_ITEMS = 10;
export const MAX_PROMPT_TEXT_CHARS = 160;
// Worst case this bounds the payload to ~500 tokens, leaving room for the
// system prompt + user message + 256 output inside a 1024 window.
export const MAX_PROMPT_JSON_CHARS = 2000;

function truncText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.length > MAX_PROMPT_TEXT_CHARS ? value.slice(0, MAX_PROMPT_TEXT_CHARS) + '…' : value;
}

export interface ApprovalsPayload {
  content: unknown[];
  sequences: unknown[];
  total: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function compactApprovalsForPrompt(approvals: ApprovalsPayload): string {
  const content = approvals.content.slice(0, MAX_PROMPT_LIST_ITEMS).map((c) => {
    const row = asRecord(c);
    return {
      platform: row.platform,
      format: row.format,
      text_preview: truncText(row.text_preview),
      scheduled_for: row.scheduled_for,
    };
  });
  const sequences = approvals.sequences.slice(0, MAX_PROMPT_LIST_ITEMS).map((s) => {
    const row = asRecord(s);
    return {
      sequence_name: row.sequence_name,
      step: row.step,
      subject: truncText(row.subject),
      tier: row.tier,
      first_name: row.first_name,
      last_name: row.last_name,
      company: row.company,
    };
  });

  const build = (contentRows: unknown[], sequenceRows: unknown[], truncated: boolean): string =>
    JSON.stringify({
      total: approvals.total,
      contentTotal: approvals.content.length,
      sequencesTotal: approvals.sequences.length,
      truncated,
      content: contentRows,
      sequences: sequenceRows,
    });

  let truncated =
    approvals.content.length > content.length || approvals.sequences.length > sequences.length;
  let json = build(content, sequences, truncated);

  // Hard budget: drop shown items until the payload fits. Totals stay exact.
  while (json.length > MAX_PROMPT_JSON_CHARS && (content.length > 0 || sequences.length > 0)) {
    if (content.length >= sequences.length) content.pop();
    else sequences.pop();
    truncated = true;
    json = build(content, sequences, truncated);
  }
  return json;
}
