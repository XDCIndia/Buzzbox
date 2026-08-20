import { postXTweet } from '@/lib/x-api';
import { getXBudget, recordXPost } from '@/lib/x-budget';

export const X_DAILY_POST_LIMIT = 5;

export type PublishToXResult =
  | { attempted: false }
  | { attempted: true; ok: true; tweetId: string }
  | { attempted: true; ok: false; status: number; error: string };

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

  const accessToken = process.env.X_ACCESS_TOKEN;
  if (!accessToken) {
    return {
      attempted: true,
      ok: false,
      status: 412,
      error:
        'X_ACCESS_TOKEN is not configured. Posting requires an OAuth user-context access token with the tweet.write scope (distinct from the read-only X_BEARER_TOKEN) -- add it to .env.local to enable posting to X.',
    };
  }

  const budget = getXBudget();
  if (budget.posts >= X_DAILY_POST_LIMIT) {
    return {
      attempted: true,
      ok: false,
      status: 423,
      error: `Daily X post limit (${X_DAILY_POST_LIMIT}) already reached for today. Try again tomorrow.`,
    };
  }

  const text = (opts.text || '').trim();
  if (!text) {
    return { attempted: true, ok: false, status: 400, error: 'Post has no content to publish to X.' };
  }

  try {
    const posted = await postXTweet({ accessToken, text });
    recordXPost(posted.id);
    return { attempted: true, ok: true, tweetId: posted.id };
  } catch (err) {
    return { attempted: true, ok: false, status: 502, error: (err as Error).message };
  }
}
