import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireApiCapability, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { allowPolicyWrite, getInstance, resolveOpenClawPaths } from '@/lib/instances';

export const dynamic = 'force-dynamic';

interface MemoryPolicy {
  decay_half_life_days: number;
  min_effective_confidence: number;
  min_keep_confidence: number;
  low_confidence_prune_days: number;
  default_ttl_days: number;
}

const DEFAULT_POLICY: MemoryPolicy = {
  decay_half_life_days: 45,
  min_effective_confidence: 0.35,
  min_keep_confidence: 0.55,
  low_confidence_prune_days: 30,
  default_ttl_days: 90,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sanitize(input: Partial<MemoryPolicy>): MemoryPolicy {
  return {
    decay_half_life_days: clamp(
      Number(input.decay_half_life_days ?? DEFAULT_POLICY.decay_half_life_days),
      7,
      365,
    ),
    min_effective_confidence: clamp(
      Number(input.min_effective_confidence ?? DEFAULT_POLICY.min_effective_confidence),
      0,
      1,
    ),
    min_keep_confidence: clamp(
      Number(input.min_keep_confidence ?? DEFAULT_POLICY.min_keep_confidence),
      0,
      1,
    ),
    low_confidence_prune_days: clamp(
      Number(input.low_confidence_prune_days ?? DEFAULT_POLICY.low_confidence_prune_days),
      1,
      365,
    ),
    default_ttl_days: clamp(
      Number(input.default_ttl_days ?? DEFAULT_POLICY.default_ttl_days),
      7,
      365,
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
    policyFile: path.join(healthDir, 'memory-policy.json'),
    auditFile: path.join(logsDir, 'memory-policy-audit.jsonl'),
  };
}

function readPolicy(policyFile: string): MemoryPolicy {
  try {
    if (!fs.existsSync(policyFile)) return DEFAULT_POLICY;
    const raw = fs.readFileSync(policyFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MemoryPolicy>;
    return sanitize(parsed);
  } catch {
    return DEFAULT_POLICY;
  }
}

function writePolicy(policyFile: string, policy: MemoryPolicy): void {
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
    const policy = readPolicy(policyFile);
    return NextResponse.json({ instance: instance.id, policy });
  } catch (error) {
    console.error('GET /api/memory-policy error:', error);
    return NextResponse.json({ error: 'Failed to read memory policy' }, { status: 500 });
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
    const body = (await request.json()) as Partial<MemoryPolicy> & { instance?: string; namespace?: string };
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
    console.error('POST /api/memory-policy error:', error);
    return NextResponse.json({ error: 'Failed to update memory policy' }, { status: 500 });
  }
}

