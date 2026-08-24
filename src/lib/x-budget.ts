import fs from 'node:fs';
import path from 'node:path';
import { getHermesStateDir } from '@/lib/hermes-state';

// Best-effort tracking of daily X API usage against the fixed-tier limits
// (search calls + posts). Mirrors the JSON shape src/app/api/x-budget/route.ts
// already expects: { date, calls, posts, queries, posted }.
//
// NOTE: this file previously did not exist in the repo even though issue #14
// ("fix search-call tracking") was closed as completed -- the fix was
// apparently only ever applied locally and never committed/pushed. This
// module rebuilds that infrastructure from scratch (see PR for #15).

const STATE_DIR = getHermesStateDir();
const BUDGET_PATH = path.join(STATE_DIR, 'x-api-budget.json');

export interface XBudget {
  date: string;
  calls: number;
  posts: number;
  queries: string[];
  posted: string[];
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function freshBudget(): XBudget {
  return { date: today(), calls: 0, posts: 0, queries: [], posted: [] };
}

function readBudgetFile(): XBudget {
  try {
    if (!fs.existsSync(BUDGET_PATH)) return freshBudget();
    const raw = fs.readFileSync(BUDGET_PATH, 'utf-8').trim();
    if (!raw) return freshBudget();
    const parsed = JSON.parse(raw) as Partial<XBudget> | null;
    if (!parsed || typeof parsed !== 'object') return freshBudget();
    return {
      date: typeof parsed.date === 'string' ? parsed.date : today(),
      calls: typeof parsed.calls === 'number' ? parsed.calls : 0,
      posts: typeof parsed.posts === 'number' ? parsed.posts : 0,
      queries: Array.isArray(parsed.queries) ? parsed.queries.filter((q): q is string => typeof q === 'string') : [],
      posted: Array.isArray(parsed.posted) ? parsed.posted.filter((p): p is string => typeof p === 'string') : [],
    };
  } catch {
    return freshBudget();
  }
}

function writeBudgetFile(budget: XBudget): void {
  try {
    fs.mkdirSync(path.dirname(BUDGET_PATH), { recursive: true });
    fs.writeFileSync(BUDGET_PATH, JSON.stringify(budget, null, 2), 'utf-8');
  } catch {
    // Best-effort only -- budget tracking must never break the caller.
  }
}

/** Resets the in-memory budget to a fresh day if the stored date has rolled over. */
function withDailyReset(budget: XBudget): XBudget {
  const t = today();
  if (budget.date !== t) return freshBudget();
  return budget;
}

/** Best-effort read of today's budget (applies the daily reset, but does not persist it). */
export function getXBudget(): XBudget {
  return withDailyReset(readBudgetFile());
}

/**
 * Records a search API call against today's budget. Increments `calls` and
 * appends `label` (typically the request URL/query) to `queries`. Resets the
 * whole budget first if the stored date is not today. Best-effort: never throws.
 */
export function recordXSearchCall(label: string): void {
  try {
    const budget = withDailyReset(readBudgetFile());
    budget.calls += 1;
    budget.queries.push(label);
    writeBudgetFile(budget);
  } catch {
    // Best-effort only.
  }
}

/**
 * Records a successful post against today's budget. Increments `posts` and
 * appends `label` (typically the resulting tweet id) to `posted`. Resets the
 * whole budget first if the stored date is not today. Best-effort: never throws.
 */
export function recordXPost(label: string): void {
  try {
    const budget = withDailyReset(readBudgetFile());
    budget.posts += 1;
    budget.posted.push(label);
    writeBudgetFile(budget);
  } catch {
    // Best-effort only.
  }
}
