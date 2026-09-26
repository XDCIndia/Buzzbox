/* Pure helpers for brand mention sync (#121). Kept out of the route module:
 * Next.js rejects non-handler exports from route.ts at build type-check. */

/** Maximum keywords fanned out per sync. Each keyword multiplies provider
 * calls (and X searches count against the daily budget), so brands with
 * long keyword lists sync the first five. */
export const MAX_SYNC_KEYWORDS = 5;

export function syncQueriesForBrand(keywords: string[], brandName: string): string[] {
  const cleaned = [...new Set(keywords.map(k => String(k || '').trim()).filter(Boolean))];
  const queries = (cleaned.length ? cleaned : [brandName]).slice(0, MAX_SYNC_KEYWORDS);
  return queries.length ? queries : [brandName];
}

/** Provider error bodies (e.g. `X API failed (status): <body>`) must stay
 * server-side per the #51 hygiene rule: first line only, markup stripped,
 * whitespace collapsed, capped length. */
export function conciseProviderError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split('\n')[0].trim();
  const noMarkup = firstLine.replace(/<[^>]*>/g, '');
  const collapsed = noMarkup.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, 200) || 'Provider request failed';
}

export type ProviderOutcome =
  | { platform: string; inserted: number }
  | { platform: string; error: string };

function isProviderFailure(o: ProviderOutcome): o is { platform: string; error: string } {
  return 'error' in o;
}

/** Honest status for a best-effort fan-out: 200 when everything worked, 207
 * on partial failure, 502 when every configured provider failed. */
export function buildMentionSyncResponse(outcomes: ProviderOutcome[], skipped: string[], queries: string[]): {
  status: 200 | 207 | 502;
  body: { synced: number; skipped: string[]; queries: string[]; errors?: Record<string, string> };
} {
  const failures = outcomes.filter(isProviderFailure);
  const errors: Record<string, string> = {};
  for (const f of failures) errors[f.platform] = f.error;
  const synced = outcomes.reduce((n, o) => n + ('inserted' in o ? o.inserted : 0), 0);
  const body: { synced: number; skipped: string[]; queries: string[]; errors?: Record<string, string> } = {
    synced,
    skipped,
    queries,
  };
  if (failures.length) body.errors = errors;
  const status = failures.length === 0 ? 200 : failures.length < outcomes.length ? 207 : 502;
  return { status, body };
}
