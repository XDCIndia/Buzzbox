import { spawn } from 'node:child_process';

const ADMIN_CLI = process.env.HERMES_ADMIN_CLI || process.env.OPENCLAW_BIN || 'openclaw';

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** True when the child was killed for exceeding timeoutMs. */
  timedOut: boolean;
  /** True when stdout/stderr hit MAX_OUTPUT_BYTES and were truncated. */
  truncated: boolean;
}

/** Per-stream output cap: a chatty child must not OOM the server (#151). */
export const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;

/**
 * Run a leads-admin CLI command (wraps openclaw with leads env).
 * Resolves on exit with (possibly truncated) output; rejects on spawn
 * error or when the child is killed for exceeding timeoutMs -- a timeout
 * must surface as a failure, never as a partial success (#151).
 */
export function runLeadsAdmin(
  args: string[],
  opts: { timeoutMs?: number; bin?: string } = {},
): Promise<CommandResult> {
  const bin = opts.bin || ADMIN_CLI;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const append = (target: 'stdout' | 'stderr', chunk: unknown) => {
      const text = String(chunk);
      if (target === 'stdout') {
        if (stdout.length >= MAX_COMMAND_OUTPUT_BYTES) {
          truncated = true;
          return;
        }
        stdout += text.slice(0, MAX_COMMAND_OUTPUT_BYTES - stdout.length);
        if (stdout.length >= MAX_COMMAND_OUTPUT_BYTES) truncated = true;
      } else {
        if (stderr.length >= MAX_COMMAND_OUTPUT_BYTES) {
          truncated = true;
          return;
        }
        stderr += text.slice(0, MAX_COMMAND_OUTPUT_BYTES - stderr.length);
        if (stderr.length >= MAX_COMMAND_OUTPUT_BYTES) truncated = true;
      }
    };

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    child.stdout.on('data', (d) => { append('stdout', d); });
    child.stderr.on('data', (d) => { append('stderr', d); });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const err = new Error(`Command timed out after ${opts.timeoutMs}ms: ${bin} ${(args[0] ?? '').toString()}`) as Error & {
          timedOut: true;
          stdout: string;
          stderr: string;
        };
        err.timedOut = true;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr, code, timedOut: false, truncated });
    });
  });
}

/**
 * Send a message to an agent via the gateway.
 * Uses `leads-admin agent --agent <id> --message <text> --json`
 * Returns the agent's response text.
 */
export async function sendAgentMessage(
  agentId: string,
  message: string,
  sessionId?: string,
): Promise<{ response: string; sessionId?: string }> {
  const args = [
    'agent',
    '--agent', agentId,
    '--message', message,
    '--json',
  ];
  if (sessionId) {
    args.push('--session-id', sessionId);
  }

  const result = await runLeadsAdmin(args, { timeoutMs: 120_000 });

  // Parse JSON response
  try {
    const data = JSON.parse(result.stdout);
    return {
      response: data.response || data.content || result.stdout.trim(),
      sessionId: data.sessionId,
    };
  } catch {
    // Fall back to raw stdout
    return { response: result.stdout.trim() };
  }
}

/**
 * Send a message to the default orchestrator routing via leads-admin.
 * Uses `leads-admin agent --message <text> --json` (no explicit --agent).
 */
export async function sendOrchestratorMessage(
  message: string,
  sessionId?: string,
): Promise<{ response: string; sessionId?: string }> {
  const args = [
    'agent',
    '--message', message,
    '--json',
  ];
  if (sessionId) {
    args.push('--session-id', sessionId);
  }

  const result = await runLeadsAdmin(args, { timeoutMs: 120_000 });

  try {
    const data = JSON.parse(result.stdout);
    return {
      response: data.response || data.content || result.stdout.trim(),
      sessionId: data.sessionId,
    };
  } catch {
    return { response: result.stdout.trim() };
  }
}
