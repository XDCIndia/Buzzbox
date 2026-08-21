import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireApiCapability, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { allowPolicyWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

interface AlertPolicy {
  window_days: number;
  alert_contradictions_threshold: number;
  alert_duplicates_threshold: number;
  alert_weak_agents_threshold: number;
  alert_never_ratio_threshold: number;
}

const DEFAULT_POLICY: AlertPolicy = {
  window_days: 7,
  alert_contradictions_threshold: 1,
  alert_duplicates_threshold: 1,
  alert_weak_agents_threshold: 1,
  alert_never_ratio_threshold: 0.7,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sanitize(input: Partial<AlertPolicy>): AlertPolicy {
  return {
    window_days: clamp(Number(input.window_days ?? DEFAULT_POLICY.window_days), 1, 90),
    alert_contradictions_threshold: clamp(
      Number(input.alert_contradictions_threshold ?? DEFAULT_POLICY.alert_contradictions_threshold),
      1,
      100,
    ),
    alert_duplicates_threshold: clamp(
      Number(input.alert_duplicates_threshold ?? DEFAULT_POLICY.alert_duplicates_threshold),
      1,
      100,
    ),
    alert_weak_agents_threshold: clamp(
      Number(input.alert_weak_agents_threshold ?? DEFAULT_POLICY.alert_weak_agents_threshold),
      1,
      100,
    ),
    alert_never_ratio_threshold: clamp(
      Number(input.alert_never_ratio_threshold ?? DEFAULT_POLICY.alert_never_ratio_threshold),
      0,
      1,
    ),
  };
}

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

function policyPaths(instanceId: string | null) {
  const instance = getInstance(instanceId);
  const { healthDir, logsDir } = resolveOpenClawPaths(instance);
  return {
    instance,
    policyFile: path.join(healthDir, 'memory-alert-policy.json'),
    auditFile: path.join(logsDir, 'memory-alert-policy-audit.jsonl'),
  };
}

function readPolicy(policyFile: string): AlertPolicy {
  try {
    if (!fs.existsSync(policyFile)) return DEFAULT_POLICY;
    const raw = fs.readFileSync(policyFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AlertPolicy>;
    return sanitize(parsed);
  } catch {
    return DEFAULT_POLICY;
  }
}

function writePolicy(policyFile: string, policy: AlertPolicy): void {
  fs.mkdirSync(path.dirname(policyFile), { recursive: true });
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + '\n', 'utf-8');
}

function appendAudit(auditFile: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.appendFileSync(auditFile, `${JSON.stringify(payload)}\n`, 'utf-8');
}

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const { instance, policyFile } = policyPaths(getInstanceId(request));
    return NextResponse.json({ instance: instance.id, policy: readPolicy(policyFile) });
  } catch (error) {
    console.error('GET /api/memory-alert-policy error:', error);
    return NextResponse.json({ error: 'Failed to read memory alert policy' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireApiCapability(request, 'manage_system');
  if (auth) return auth;
  if (!allowPolicyWrite()) {
    return NextResponse.json(
      { error: 'Policy write disabled (set HERMES_ALLOW_POLICY_WRITE=true to enable)' },
      { status: 403 },
    );
  }

  try {
    const actor = requireUser(request);
    const body = (await request.json()) as Partial<AlertPolicy> & { instance?: string; namespace?: string };
    const instanceId = body.instance ?? body.namespace ?? getInstanceId(request) ?? undefined;
    const { instance, policyFile, auditFile } = policyPaths(instanceId ?? null);
    const before = readPolicy(policyFile);
    const policy = sanitize(body);
    writePolicy(policyFile, policy);
    appendAudit(auditFile, {
      timestamp: new Date().toISOString(),
      actor: actor.username,
      actor_role: actor.role,
      instance: instance.id,
      before,
      after: policy,
    });
    return NextResponse.json({ ok: true, instance: instance.id, policy });
  } catch (error) {
    console.error('POST /api/memory-alert-policy error:', error);
    return NextResponse.json({ error: 'Failed to update memory alert policy' }, { status: 500 });
  }
}

