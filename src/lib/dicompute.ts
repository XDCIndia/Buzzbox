import { fetchWithTimeout } from './fetch-with-timeout';

const DICOMPUTE_BASE_URL =
  process.env.DICOMPUTE_BASE_URL || 'https://api.dicompute.ai/v1';

const DICOMPUTE_MODEL =
  process.env.DICOMPUTE_MODEL || 'qwen2.5-7b-instruct';

const DICOMPUTE_API_KEY = process.env.DICOMPUTE_API_KEY;

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

/** Thrown when the upstream LLM provider answers non-2xx. The raw response
 * body (which can be a large Cloudflare/provider HTML error page) is logged
 * server-side only -- the exposed message is a concise, status-based summary
 * so the UI never renders provider HTML (#51). */
export class UpstreamProviderError extends Error {
  readonly status: number;
  constructor(status: number) {
    const reason = HTTP_STATUS_REASONS[status] ?? `HTTP ${status}`;
    super(
      `Buzz AI is temporarily unavailable. The AI provider returned ${status} ${reason}. Please try again later.`,
    );
    this.name = 'UpstreamProviderError';
    this.status = status;
  }
}

export interface DicomputeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function askDicompute(
  messages: DicomputeMessage[],
) {
  if (!DICOMPUTE_API_KEY) {
    throw new MissingConfigError(
      'DICOMPUTE_API_KEY is not configured. Buzz requires the Dicompute LLM connector -- set DICOMPUTE_API_KEY in the environment to enable it.',
    );
  }

  const response = await fetchWithTimeout(
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
        stream: false,
      }),
    },
  );

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

  const data = await response.json();

  return {
    content: data?.choices?.[0]?.message?.content || '',
    model: data?.model || DICOMPUTE_MODEL,
    raw: data,
  };
}