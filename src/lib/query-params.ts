import type { NextRequest } from 'next/server';

/**
 * Parse a numeric query param and clamp it to [lo, hi].
 *
 * Returns `fallback` when the param is absent or unparseable (NaN from
 * `Number('abc')`, empty string, etc.), so callers get sane defaults for
 * free and never an unbounded value (#64).
 *
 * Non-integers are floored; negatives/overflows are clamped.
 */
export function clampParam(
  req: NextRequest,
  key: string,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const raw = req.nextUrl.searchParams.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
