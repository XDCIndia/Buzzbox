import { fetchWithTimeout, TimeoutError } from './fetch-with-timeout';

const DICOMPUTE_BASE_URL =
  process.env.DICOMPUTE_BASE_URL || 'https://api.dicompute.ai/v1';

const DICOMPUTE_MODEL =
  process.env.DICOMPUTE_MODEL || 'qwen2.5-7b-instruct';

const DICOMPUTE_API_KEY = process.env.DICOMPUTE_API_KEY;

/**
 * Output cap. Buzz's decision calls emit <60-token JSON and its summaries fit
 * comfortably in a few hundred tokens, so 256 keeps prompt+output inside
 * small-context models (qwen2.5-3b-instruct serves a 1024-token window: the
 * decision prompt is ~1630 chars / ~410 tokens, so prompt+output lands near
 * 670 of 1024 -- an uncapped provider-default output budget overflows it).
 * Overridable without a code change if the serving model window changes.
 */
function parseMaxTokens(): number {
  const raw = Number.parseInt(process.env.DICOMPUTE_MAX_TOKENS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0 && raw <= 4096) return raw;
  return 256;
}

const DICOMPUTE_MAX_TOKENS = parseMaxTokens();

/**
 * Per-attempt deadline (matches the repo-wide DEFAULT_FETCH_TIMEOUT_MS).
 * Healthy completions from the serving model finish in ~2-8s; requests still
 * pending past ~15s are the ones the provider's edge eventually answers with a
 * Cloudflare 502 (or never answers at all), so waiting longer mostly burns the
 * chat's time budget -- fail fast and let the retry loop pick another attempt.
 */
function parseTimeoutMs(): number {
  const raw = Number.parseInt(process.env.DICOMPUTE_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 300_000) return raw;
  return 15_000;
}

const DICOMPUTE_TIMEOUT_MS = parseTimeoutMs();

/**
 * Attempts per call (1 disables retrying). The provider fails intermittently
 * under load -- bursts of Cloudflare 502s observed on identical payloads --
 * and an immediate follow-up attempt recovered every time it was tried (#225).
 */
function parseAttempts(): number {
  const raw = Number.parseInt(process.env.DICOMPUTE_MAX_ATTEMPTS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 4) return raw;
  return 3;
}

const DICOMPUTE_MAX_ATTEMPTS = parseAttempts();

/** Backoff base between attempts (attempt N waits base * N). */
function parseRetryBackoffMs(): number {
  const raw = Number.parseInt(process.env.DICOMPUTE_RETRY_BACKOFF_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 30_000) return raw;
  return 300;
}

const DICOMPUTE_RETRY_BACKOFF_MS = parseRetryBackoffMs();

/**
 * Hard ceiling for a whole askDicompute call -- retries and backoff included --
 * so the chat UI can never sit on "Buzz is thinking..." for minutes (#225).
 */
function parseTotalTimeoutMs(): number {
  const raw = Number.parseInt(process.env.DICOMPUTE_TOTAL_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  return 60_000;
}

const DICOMPUTE_TOTAL_TIMEOUT_MS = parseTotalTimeoutMs();

/**
 * Serving context window in tokens (qwen2.5-3b-instruct = 1024). Used to fit
 * the prompt so prompt+output cannot overflow it -- an overflowing request is
 * exactly the shape the upstream worker answers with a 502 (#225).
 */
function parseContextWindow(): number {
  const raw = Number.parseInt(process.env.DICOMPUTE_CONTEXT_WINDOW ?? '', 10);
  if (Number.isFinite(raw) && raw >= 256 && raw <= 1_000_000) return raw;
  return 1024;
}

const DICOMPUTE_CONTEXT_WINDOW = parseContextWindow();

/**
 * Optional local fallback (#225): when DiCompute is overloaded or down and
 * OLLAMA_BASE_URL points at a local Ollama server, the same request is served
 * through Ollama's OpenAI-compatible endpoint instead of failing the chat.
 * Unset (the default) disables the fallback entirely.
 */
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || '').replace(/\/+$/, '');

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

/** Thrown when the Dicompute connector lacks configuration (e.g. no API key).
 * Route handlers catch this to answer 4xx "precondition failed" instead of
 * masking a configuration state as a 500 server error (#88). */
export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingConfigError';
  }
}

const HTTP_STATUS_REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Transient statuses are worth another attempt: the provider's own edge is
 * failing (5xx / no response) or asking us to slow down (408/429). Everything
 * else (400/401/403/404...) is a request or configuration problem that a retry
 * would only repeat. `0` means no HTTP response at all (timeout, connection
 * reset, or an unparseable body).
 */
function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Thrown when the upstream LLM provider answers non-2xx, does not answer in
 * time, or returns an unusable body. The raw response body (which can be a
 * large Cloudflare/provider HTML error page) is logged server-side only -- the
 * exposed message is a concise, status-based summary so the UI never renders
 * provider HTML (#51).
 *
 * 401/403 are configuration states (bad, revoked, or endpoint-mismatched
 * key), not transient outages, so they carry actionable guidance instead of
 * retry advice (#205).
 *
 * `retryable` tells route handlers whether the failure is transient, so the
 * chat UI can offer a retry action instead of a permanent crash bubble (#225). */
export class UpstreamProviderError extends Error {
  /** HTTP status, or 0 when no usable response arrived (timeout/connection). */
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, options: { retryable?: boolean } = {}) {
    const reason = HTTP_STATUS_REASONS[status] ?? `HTTP ${status}`;
    super(
      status === 0
        ? 'Buzz AI is temporarily unavailable. The AI provider did not respond in time. Please try again later.'
        : status === 401 || status === 403
          ? `Buzz AI rejected the request (${status} ${reason}). Check DICOMPUTE_API_KEY and its DICOMPUTE_BASE_URL pairing.`
          : `Buzz AI is temporarily unavailable. The AI provider returned ${status} ${reason}. Please try again later.`,
    );
    this.name = 'UpstreamProviderError';
    this.status = status;
    this.retryable = options.retryable ?? isTransientStatus(status);
  }
}

export interface DicomputeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DicomputeResult {
  content: string;
  model: string;
  provider: 'dicompute' | 'ollama';
  raw: unknown;
}

const TRUNCATION_MARKER =
  '\n…[content truncated to fit the model context window]';

/** Cheap token estimate (chars/4). Deliberately approximate: it only has to
 * be conservative enough to keep prompt+output inside the serving window. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= TRUNCATION_MARKER.length) return text.slice(0, maxChars);
  return text.slice(0, maxChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * Fit the message list inside `budgetTokens`, trimming the LARGEST message
 * content first so the system prompt and the user's actual question survive.
 * Payloads that fit (today's normal case: decision prompt ~410 tokens, data
 * summaries a few hundred) are returned untouched; only genuinely oversized
 * inputs are clipped, with a visible marker instead of a silent cut.
 */
export function fitMessagesToContext(
  messages: DicomputeMessage[],
  budgetTokens: number,
): DicomputeMessage[] {
  const fitted = messages.map((m) => ({ ...m }));
  // ~4 tokens of per-message framing (role + separators).
  const overhead = fitted.length * 4;
  const budgetChars = Math.max(0, (budgetTokens - overhead) * 4);

  const usedChars = () => fitted.reduce((sum, m) => sum + m.content.length, 0);
  let used = usedChars();
  if (used <= budgetChars) return fitted;

  console.warn(
    `[dicompute] prompt is ~${estimateTokens(
      messages.map((m) => m.content).join(''),
    )} tokens which exceeds the ${budgetTokens}-token budget; trimming the largest message`,
  );

  // Each pass shrinks the current largest message to exactly fit; its content
  // strictly decreases, so the loop always terminates.
  while (used > budgetChars) {
    let largest = 0;
    for (let i = 1; i < fitted.length; i++) {
      if (fitted[i].content.length > fitted[largest].content.length) largest = i;
    }
    const before = fitted[largest].content.length;
    const target = Math.max(0, before - (used - budgetChars));
    fitted[largest].content = truncateToChars(fitted[largest].content, target);
    if (fitted[largest].content.length === before) break;
    used = usedChars();
  }
  return fitted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse an OpenAI-shaped completion body; a 200 with an HTML body is a
 * provider failure, not a client bug. */
function readCompletion(data: unknown): { content: string; model: string } {
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> })
    ?.choices;
  return {
    content: choices?.[0]?.message?.content || '',
    model: (data as { model?: string })?.model || '',
  };
}

async function dicomputeCompletion(
  messages: DicomputeMessage[],
  timeoutMs: number,
): Promise<DicomputeResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${DICOMPUTE_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DICOMPUTE_API_KEY}`,
        },
        body: JSON.stringify({
          model: DICOMPUTE_MODEL,
          messages,
          temperature: 0.3,
          max_tokens: DICOMPUTE_MAX_TOKENS,
          stream: false,
        }),
      },
      timeoutMs,
    );
  } catch (error) {
    // Timeouts and dropped sockets are the provider's edge failing, so they
    // surface as a transient upstream error (retryable) instead of leaking a
    // raw fetch/abort error into the route's generic 500 branch.
    if (error instanceof TimeoutError) {
      console.warn(`[dicompute] attempt timed out: ${error.message}`);
      throw new UpstreamProviderError(0);
    }
    console.warn(
      '[dicompute] network error contacting provider:',
      error instanceof Error ? error.message : String(error),
    );
    throw new UpstreamProviderError(0);
  }

  if (!response.ok) {
    const body = await response.text();

    // Full upstream body stays server-side only: it can be a large
    // Cloudflare/provider HTML error page that must never reach the UI (#51).
    console.error(
      `[dicompute] Upstream error ${response.status} body (truncated):`,
      body.slice(0, 2000),
    );

    throw new UpstreamProviderError(response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    console.warn(
      '[dicompute] provider returned a non-JSON 200 body:',
      error instanceof Error ? error.message : String(error),
    );
    throw new UpstreamProviderError(0);
  }

  const parsed = readCompletion(data);
  return {
    content: parsed.content,
    model: parsed.model || DICOMPUTE_MODEL,
    provider: 'dicompute',
    raw: data,
  };
}

async function ollamaCompletion(
  messages: DicomputeMessage[],
  timeoutMs: number,
): Promise<DicomputeResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${OLLAMA_BASE_URL}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages,
          temperature: 0.3,
          max_tokens: DICOMPUTE_MAX_TOKENS,
          stream: false,
        }),
      },
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn(`[ollama] attempt timed out: ${error.message}`);
      throw new UpstreamProviderError(0);
    }
    console.warn(
      '[ollama] network error contacting local server:',
      error instanceof Error ? error.message : String(error),
    );
    throw new UpstreamProviderError(0);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `[ollama] Upstream error ${response.status} body (truncated):`,
      body.slice(0, 2000),
    );
    throw new UpstreamProviderError(response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    console.warn(
      '[ollama] server returned a non-JSON 200 body:',
      error instanceof Error ? error.message : String(error),
    );
    throw new UpstreamProviderError(0);
  }

  const parsed = readCompletion(data);
  return {
    content: parsed.content,
    model: parsed.model || OLLAMA_MODEL,
    provider: 'ollama',
    raw: data,
  };
}

export async function askDicompute(
  messages: DicomputeMessage[],
): Promise<DicomputeResult> {
  if (!DICOMPUTE_API_KEY) {
    throw new MissingConfigError(
      'DICOMPUTE_API_KEY is not configured. Buzz requires the Dicompute LLM connector -- set DICOMPUTE_API_KEY in the environment to enable it.',
    );
  }

  // Keep prompt+output inside the serving window before the first attempt.
  const fitted = fitMessagesToContext(
    messages,
    DICOMPUTE_CONTEXT_WINDOW - DICOMPUTE_MAX_TOKENS,
  );

  const deadline = Date.now() + DICOMPUTE_TOTAL_TIMEOUT_MS;

  let lastError: UpstreamProviderError | undefined;

  for (let attempt = 1; attempt <= DICOMPUTE_MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    try {
      return await dicomputeCompletion(
        fitted,
        Math.min(DICOMPUTE_TIMEOUT_MS, remaining),
      );
    } catch (error) {
      if (!(error instanceof UpstreamProviderError)) throw error;
      lastError = error;

      // Configuration and malformed-request failures would just repeat.
      if (!error.retryable) throw error;
      if (attempt === DICOMPUTE_MAX_ATTEMPTS) break;

      const backoff = DICOMPUTE_RETRY_BACKOFF_MS * attempt;
      const wait = Math.min(backoff, Math.max(0, deadline - Date.now()));
      console.warn(
        `[dicompute] attempt ${attempt}/${DICOMPUTE_MAX_ATTEMPTS} failed with ${
          error.status || 'no response'
        }; retrying in ${wait}ms`,
      );
      if (wait > 0) await sleep(wait);
    }
  }

  const failure =
    lastError ?? new UpstreamProviderError(0);

  // Local fallback (#225): DiCompute is down/overloaded and Ollama is
  // configured, so serve the request locally instead of failing the chat.
  if (OLLAMA_BASE_URL && failure.retryable) {
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      console.warn(
        `[dicompute] falling back to Ollama at ${OLLAMA_BASE_URL} after ${
          failure.status || 'no response'
        } from the primary provider`,
      );
      try {
        return await ollamaCompletion(fitted, Math.min(DICOMPUTE_TIMEOUT_MS, remaining));
      } catch (fallbackError) {
        console.warn(
          '[dicompute] Ollama fallback failed:',
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
        );
      }
    }
  }

  throw failure;
}
