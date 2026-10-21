import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* Regression tests for issue #225: DiCompute's edge answers intermittent
 * Cloudflare 502s (and drops sockets) under load, which used to fail the Buzz
 * chat on the first bad attempt. askDicompute must now:
 *   - retry transient failures (5xx/429/408, timeouts, connection drops)
 *     a bounded number of times with backoff,
 *   - never retry request/configuration failures (400/401/403),
 *   - fall back to a local Ollama server when OLLAMA_BASE_URL is configured
 *     and the primary provider is still failing transiently,
 *   - and fit oversized prompts to the serving context window so prompt+output
 *     cannot overflow it (the shape upstream answers with a 502).
 *
 * Dynamic imports AFTER env setup: the DICOMPUTE_* and OLLAMA_* vars are
 * captured when the module loads. No DB is needed -- dicompute.ts is pure fetch. */

const tempDir = mkdtempSync(path.join(tmpdir(), 'hermes-dicompute-retry-'));
process.env.HERMES_DB_PATH = path.join(tempDir, 'hermes-test.db');
process.env.HERMES_STATE_DIR = tempDir;

type PrimaryMode =
  | 'ok'
  | 'flaky-502'
  | 'always-502'
  | 'bad-400'
  | 'forbidden-401';

let primaryMode: PrimaryMode = 'ok';
let ollamaMode: 'ok' | 'down' = 'ok';
let dicomputeHits = 0;
let ollamaHits = 0;
let lastBody: {
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  stream?: boolean;
  model?: string;
} | null = null;

const UPSTREAM_HTML = `<!DOCTYPE html><html><body><h1>cloudflare</h1>${'x'.repeat(5000)}</body></html>`;

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// One server backs BOTH providers: /openai/v1/* is DiCompute, /v1/* is Ollama.
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    try {
      lastBody = JSON.parse(raw);
    } catch {
      lastBody = null;
    }

    const isOllama = req.url?.startsWith('/v1/chat/completions') ?? false;

    if (isOllama) {
      ollamaHits += 1;
      if (ollamaMode === 'down') {
        json(res, 500, { error: 'local model unavailable' });
        return;
      }
      json(res, 200, {
        model: 'llama3.2',
        choices: [{ message: { content: 'served locally by ollama' } }],
      });
      return;
    }

    dicomputeHits += 1;
    if (primaryMode === 'always-502' || (primaryMode === 'flaky-502' && dicomputeHits === 1)) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(UPSTREAM_HTML);
      return;
    }
    if (primaryMode === 'bad-400') {
      json(res, 400, { error: { message: 'max_tokens must be positive' } });
      return;
    }
    if (primaryMode === 'forbidden-401') {
      json(res, 401, { error: { message: 'invalid api key' } });
      return;
    }
    json(res, 200, {
      model: 'qwen2.5-3b-instruct',
      choices: [{ message: { content: '{"action":"respond","message":"hi"}' } }],
    });
  });
});

let dicompute: typeof import('./dicompute');

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  process.env.DICOMPUTE_API_KEY = 'test-key';
  process.env.DICOMPUTE_BASE_URL = `http://127.0.0.1:${port}/openai/v1`;
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OLLAMA_MODEL = 'llama3.2';
  process.env.DICOMPUTE_MAX_ATTEMPTS = '3';
  process.env.DICOMPUTE_RETRY_BACKOFF_MS = '1';
  delete process.env.DICOMPUTE_CONTEXT_WINDOW;
  delete process.env.DICOMPUTE_TIMEOUT_MS;
  delete process.env.DICOMPUTE_TOTAL_TIMEOUT_MS;
  dicompute = await import('./dicompute');
});

after(() => {
  server.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const messages = [{ role: 'user' as const, content: 'ping' }];

function reset(primary: PrimaryMode, ollama: 'ok' | 'down' = 'ok') {
  primaryMode = primary;
  ollamaMode = ollama;
  dicomputeHits = 0;
  ollamaHits = 0;
  lastBody = null;
}

test('recovers from a transient 502 with a bounded retry instead of failing the chat (#225)', async () => {
  reset('flaky-502');
  const out = await dicompute.askDicompute(messages);
  assert.equal(out.content, '{"action":"respond","message":"hi"}');
  assert.equal(out.provider, 'dicompute');
  assert.equal(dicomputeHits, 2, 'exactly one retry after the failed attempt');
});

test('exhausts attempts on a persistent 502 and rejects with a concise retryable error (#225)', async () => {
  // Ollama is down too, so the primary's failure is what the chat surfaces.
  reset('always-502', 'down');
  await assert.rejects(
    () => dicompute.askDicompute(messages),
    (err: unknown) => {
      assert.ok(err instanceof dicompute.UpstreamProviderError);
      assert.equal(err.status, 502);
      assert.equal(err.retryable, true);
      assert.match(err.message, /502 Bad Gateway/);
      assert.ok(!err.message.includes('<html'), 'provider HTML must not leak');
      assert.ok(err.message.length < 200, 'message must stay concise');
      return true;
    },
  );
  assert.equal(dicomputeHits, 3, 'DICOMPUTE_MAX_ATTEMPTS caps the fan-out');
});

test('does not retry request failures (400) -- a retry would only repeat them', async () => {
  reset('bad-400');
  await assert.rejects(
    () => dicompute.askDicompute(messages),
    (err: unknown) => {
      assert.ok(err instanceof dicompute.UpstreamProviderError);
      assert.equal(err.status, 400);
      assert.equal(err.retryable, false);
      return true;
    },
  );
  assert.equal(dicomputeHits, 1, '400 must be attempted exactly once');
});

test('does not retry configuration failures (401) and keeps config guidance (#205)', async () => {
  reset('forbidden-401');
  await assert.rejects(
    () => dicompute.askDicompute(messages),
    (err: unknown) => {
      assert.ok(err instanceof dicompute.UpstreamProviderError);
      assert.equal(err.status, 401);
      assert.equal(err.retryable, false);
      assert.match(err.message, /DICOMPUTE_API_KEY/);
      assert.ok(!err.message.includes('try again later'));
      return true;
    },
  );
  assert.equal(dicomputeHits, 1, '401 must be attempted exactly once');
  assert.equal(ollamaHits, 0, 'a config failure must not trigger the fallback');
});

test('falls back to local Ollama when the primary provider keeps failing transiently (#225)', async () => {
  reset('always-502');
  const out = await dicompute.askDicompute(messages);
  assert.equal(out.content, 'served locally by ollama');
  assert.equal(out.provider, 'ollama');
  assert.equal(out.model, 'llama3.2');
  assert.equal(dicomputeHits, 3, 'primary attempts run first');
  assert.equal(ollamaHits, 1, 'exactly one local fallback attempt');
});

test('uses the primary provider directly when it is healthy (no fallback traffic)', async () => {
  reset('ok');
  const out = await dicompute.askDicompute(messages);
  assert.equal(out.provider, 'dicompute');
  assert.equal(dicomputeHits, 1);
  assert.equal(ollamaHits, 0, 'healthy primary must not touch Ollama');
});

test('reports the primary failure when the Ollama fallback is also unavailable', async () => {
  reset('always-502', 'down');
  await assert.rejects(
    () => dicompute.askDicompute(messages),
    (err: unknown) => {
      assert.ok(err instanceof dicompute.UpstreamProviderError);
      // The primary's transient status drives the UI message, not the local one.
      assert.equal(err.status, 502);
      assert.equal(err.retryable, true);
      return true;
    },
  );
  assert.equal(ollamaHits, 1);
});

test('passes small prompts through untouched (no clipping marker)', async () => {
  reset('ok');
  await dicompute.askDicompute([
    { role: 'system', content: 'You are Buzz.' },
    { role: 'user', content: 'hii' },
  ]);
  const body = lastBody!;
  assert.equal(body.max_tokens, 256);
  assert.equal(body.stream, false);
  assert.ok(typeof body.model === 'string' && body.model.length > 0);
  const system = body.messages!.find((m) => m.role === 'system')!;
  assert.equal(system.content, 'You are Buzz.');
  const user = body.messages!.find((m) => m.role === 'user')!;
  assert.equal(user.content, 'hii');
});

test('clips an oversized prompt to the context budget, keeping the system prompt intact (#225)', async () => {
  reset('ok');
  const systemPrompt = 'You are Buzz, the AI assistant inside Buzzbox.';
  // 20k chars ~= 5000 tokens: far past a 1024-token serving window.
  const huge = 'data '.repeat(5000);
  await dicompute.askDicompute([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: huge },
  ]);

  const body = lastBody!;
  const system = body.messages!.find((m) => m.role === 'system')!;
  const user = body.messages!.find((m) => m.role === 'user')!;

  assert.equal(system.content, systemPrompt, 'system prompt must survive trimming');
  assert.ok(user.content.length < huge.length, 'the oversized payload must shrink');
  assert.match(user.content, /content truncated to fit the model context window\]$/);

  // 1024 context - 256 output cap = 768 prompt tokens (chars/4 estimate),
  // minus ~4 tokens of per-message framing.
  const budgetChars = (768 - 8) * 4;
  const used = body.messages!.reduce((sum, m) => sum + m.content.length, 0);
  assert.ok(used <= budgetChars, `prompt ${used} chars must fit ${budgetChars} chars`);
  assert.ok(body.max_tokens! + used / 4 <= 1024, 'prompt + output must fit the window');
});
