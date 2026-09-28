import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { requireApiCapability } from '@/lib/api-auth';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

function safeExec(cmd: string[], fallback = ''): string {
  try {
    return execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8' }).trim();
  } catch {
    return fallback;
  }
}

function validateOpenClawConfig(bin: string): {
  available: boolean;
  ok: boolean;
  details?: unknown;
  error?: string;
} {
  try {
    const stdout = execFileSync(bin, ['config', 'validate', '--json'], { encoding: 'utf-8' }).trim();
    if (!stdout) {
      return { available: true, ok: true };
    }
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const valid = parsed?.valid;
      const isValid = typeof valid === 'boolean' ? valid : true;
      return { available: true, ok: isValid, details: parsed };
    } catch {
      return { available: true, ok: true, details: stdout };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = /ENOENT|not found/i.test(message);
    return {
      available: !missing,
      ok: false,
      error: missing ? `${bin} not found in PATH` : message,
    };
  }
}

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

function latestLog(logDir: string) {
  if (!fs.existsSync(logDir)) return null;
  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.includes('deploy') && f.endsWith('.log'))
    .map((f) => path.join(logDir, f));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const as = fs.statSync(a).mtimeMs;
    const bs = fs.statSync(b).mtimeMs;
    return bs - as;
  });
  const file = files[0];
  const raw = fs.readFileSync(file, 'utf-8');
  const lines = raw.trim().split('\n').slice(-80);
  return {
    path: file,
    mtime: new Date(fs.statSync(file).mtimeMs).toISOString(),
    tail: lines,
  };
}

export async function GET(request: Request) {
  // System surface (service names, paths, pids, log tails, validator
  // output): admin-only, like the other manage_system routes (#136).
  const auth = requireApiCapability(request as Request, 'manage_system');
  if (auth) return auth;

  const instance = getInstance(getInstanceId(request));
  const { logsDir } = resolveOpenClawPaths(instance);

  const lockFile =
    process.env.HERMES_DEPLOY_LOCK_FILE?.trim() || '/tmp/hermes-dashboard-deploy.lock';
  const logDir =
    process.env.HERMES_DEPLOY_LOG_DIR?.trim() || path.join(logsDir, 'deploy');
  const scriptPath = process.env.HERMES_DEPLOY_SCRIPT_PATH?.trim() || '';
  const serviceName = process.env.HERMES_SERVICE_NAME?.trim() || 'hermes-dashboard.service';
  const openclawBin = process.env.HERMES_ADMIN_CLI || process.env.OPENCLAW_BIN || 'openclaw';

  try {
    const running = scriptPath
      ? safeExec(['pgrep', '-af', path.basename(scriptPath)], '')
      : safeExec(['pgrep', '-af', 'deploy'], '');
    const isActive = safeExec(['systemctl', 'is-active', serviceName], 'unknown');
    const log = latestLog(logDir);
    const lockExists = fs.existsSync(lockFile);
    const configValidation = validateOpenClawConfig(openclawBin);

    return NextResponse.json({
      instance: instance.id,
      service: {
        name: serviceName,
        state: isActive,
      },
      deploy: {
        script_path: scriptPath || null,
        lock_file: lockFile,
        lock_exists: lockExists,
        running_pids: running ? running.split('\n').filter(Boolean) : [],
      },
      openclaw: {
        bin: openclawBin,
        config_validate: configValidation,
      },
      latest_log: log,
    });
  } catch (error) {
    console.error('GET /api/deploy-status error:', error);
    return NextResponse.json({ error: 'Failed to read deploy status' }, { status: 500 });
  }
}
