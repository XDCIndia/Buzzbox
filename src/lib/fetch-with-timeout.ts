/**
 * fetch() with a hard deadline (#53).
 *
 * Every outbound provider request must fail fast instead of hanging a sync
 * or cron run indefinitely. Aborts the in-flight request when the deadline
 * passes and throws a distinguishable TimeoutError; caller-provided abort
 * signals are chained through (cancellation still works).
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/** Thrown when an outbound request exceeds its deadline. */
export class TimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Chain the caller's signal so explicit cancellation also aborts.
  const onExternalAbort = () => controller.abort();
  if (init.signal) {
    if (init.signal.aborted) onExternalAbort();
    else init.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !(init.signal?.aborted)) throw new TimeoutError(url, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onExternalAbort);
  }
}
