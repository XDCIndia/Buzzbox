import { postXTweet } from '@/lib/x-api';
import { getXBudget, recordXPost } from '@/lib/x-budget';
import { getDb } from '@/lib/db';

export const X_DAILY_POST_LIMIT = 5;

/** A claim older than this is assumed orphaned (crashed publisher) and may
 * be stolen by the next approver. Posting takes seconds; five minutes is
 * generous without letting a stuck claim block publishing for long. */
export const X_CLAIM_STALE_MS = 5 * 60 * 1000;

export type PublishToXResult =
  | { attempted: false }
  | { attempted: true; ok: true; tweetId: string; duplicate: boolean }
  | { attempted: true; ok: false; status: number; error: string };

export type PublishClaim =
  | { outcome: 'claimed' }
  | { outcome: 'busy' }
  | { outcome: 'already-posted'; tweetId: string };

/** Atomically claim the right to publish a content item. INSERT OR IGNORE
 * serializes concurrent approvers in SQLite itself: exactly one wins.
 * - claimed: caller may post, then must completeXPublish() or releaseXPublish().
 * - busy: another publisher holds a fresh claim (concurrent approve) -> 409.
 * - already-posted: a previous attempt posted (e.g. crashed before
 *   persisting) -> finalize without reposting. */
export function claimXPublish(contentId: string, staleMs: number = X_CLAIM_STALE_MS): PublishClaim {
  const db = getDb();
  const inserted = db
    .prepare('INSERT OR IGNORE INTO x_publish_claims (content_id, claimed_at) VALUES (?, CURRENT_TIMESTAMP)')
    .run(contentId);
  if (inserted.changes > 0) return { outcome: 'claimed' };

  const row = db
    .prepare('SELECT tweet_id AS tweetId, claimed_at AS claimedAt FROM x_publish_claims WHERE content_id = ?')
    .get(contentId) as { tweetId: string | null; claimedAt: string } | undefined;
  if (row?.tweetId) return { outcome: 'already-posted', tweetId: row.tweetId };
  const claimedAtMs = row ? Date.parse(String(row.claimedAt).replace(' ', 'T') + 'Z') : NaN;
  if (!Number.isNaN(claimedAtMs) && Date.now() - claimedAtMs > staleMs) {
    db.prepare('UPDATE x_publish_claims SET claimed_at = CURRENT_TIMESTAMP, tweet_id = NULL WHERE content_id = ?').run(contentId);
    return { outcome: 'claimed' };
  }
  return { outcome: 'busy' };
}

/** Record a successful post against the claim (idempotency proof). */
export function completeXPublish(contentId: string, tweetId: string): void {
  getDb().prepare('UPDATE x_publish_claims SET tweet_id = ? WHERE content_id = ?').run(tweetId, contentId);
}

/** Release a claim after a failed post so the next attempt can try. */
export function releaseXPublish(contentId: string): void {
  getDb().prepare('DELETE FROM x_publish_claims WHERE content_id = ? AND tweet_id IS NULL').run(contentId);
}

// In-process serialization for the check-budget -> post -> record sequence.
// The claim table serializes same-content publishers even across processes;
// the mutex additionally keeps concurrent publishes of *different* content
// from jointly overshooting the daily budget within this process (the app
// runs as a single Node process -- see rate-limit.ts design notes).
let publishMutex: Promise<void> = Promise.resolve();

function withPublishMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = publishMutex.then(fn, fn);
  publishMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Detects a queued item's approve/publish transition for platform === 'x'
 * and, if so, actually posts it to X via postXTweet -- this is the step that
 * used to be entirely missing (the budget widget's "posts" counter stayed at
 * 0/5 forever because nothing published anything).
 *
 * A "transition" is: platform is 'x', the next status is 'ready' or
 * 'published', and the previous status was neither of those already (so
 * re-saving an already-approved/published item never reposts it).
 *
 * Enforces the daily_post_limit (5) by checking the current budget before
 * posting, and requires X_ACCESS_TOKEN (an OAuth user-context token with
 * tweet.write scope -- NOT the read-only X_BEARER_TOKEN) to be configured.
 *
 * Returns { attempted: false } when no posting action applies (nothing to
 * do, caller should proceed with its normal status update).
 */
export async function maybePublishToX(opts: {
  contentId?: string | null;
  platform: string | null | undefined;
  previousStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  text: string | null | undefined;
}): Promise<PublishToXResult> {
  const isFreshXApproval =
    opts.platform === 'x' &&
    (opts.nextStatus === 'ready' || opts.nextStatus === 'published') &&
    opts.previousStatus !== 'ready' &&
    opts.previousStatus !== 'published';

  if (!isFreshXApproval) return { attempted: false };

  // Serialize publishers of the same content item: concurrent approves race
  // the status read, so the claim (not the read) decides who posts (#120).
  // Without a content id there is nothing to claim against -- proceed
  // unguarded as before.
  if (opts.contentId) {
    const claim = claimXPublish(opts.contentId);
    if (claim.outcome === 'busy') {
      return {
        attempted: true,
        ok: false,
        status: 409,
        error: 'Publish already in progress for this content. Refresh to see its status.',
      };
    }
    if (claim.outcome === 'already-posted') {
      return { attempted: true, ok: true, tweetId: claim.tweetId, duplicate: true };
    }
  }

  const accessToken = process.env.X_ACCESS_TOKEN;
  if (!accessToken) {
    if (opts.contentId) releaseXPublish(opts.contentId);
    return {
      attempted: true,
      ok: false,
      status: 412,
      error:
        'X_ACCESS_TOKEN is not configured. Posting requires an OAuth user-context access token with the tweet.write scope (distinct from the read-only X_BEARER_TOKEN) -- add it to .env.local to enable posting to X.',
    };
  }

  return withPublishMutex(async (): Promise<PublishToXResult> => {
    const budget = getXBudget();
    if (budget.posts >= X_DAILY_POST_LIMIT) {
      if (opts.contentId) releaseXPublish(opts.contentId);
      return {
        attempted: true,
        ok: false,
        status: 423,
        error: `Daily X post limit (${X_DAILY_POST_LIMIT}) already reached for today. Try again tomorrow.`,
      };
    }

    const text = (opts.text || '').trim();
    if (!text) {
      if (opts.contentId) releaseXPublish(opts.contentId);
      return { attempted: true, ok: false, status: 400, error: 'Post has no content to publish to X.' };
    }

    try {
      const posted = await postXTweet({ accessToken, text });
      recordXPost(posted.id);
      if (opts.contentId) completeXPublish(opts.contentId, posted.id);
      return { attempted: true, ok: true, tweetId: posted.id, duplicate: false };
    } catch (err) {
      if (opts.contentId) releaseXPublish(opts.contentId);
      return { attempted: true, ok: false, status: 502, error: (err as Error).message };
    }
  });
}
