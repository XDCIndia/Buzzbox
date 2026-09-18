/* Timing-safe comparison for secrets (API keys, webhook tokens).
 *
 * A naive `a === b` leaks length and prefix information through timing.
 * timingSafeEqual requires equal-length buffers, so we hash both sides
 * with SHA-256 first — the fixed-size digests avoid the length-mismatch
 * throw and add negligible overhead.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export function secureCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
