import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLeads, getLeadFunnel, updateLeadStatus } from '@/lib/queries';
import {
  writebackLeadCreate,
  writebackLeadDelete,
  writebackLeadStatus,
  writebackLeadUpdate,
} from '@/lib/writeback';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

const ALLOWED_LEAD_STATUSES = new Set([
  'new',
  'validated',
  'approved',
  'contacted',
  'replied',
  'interested',
  'booked',
  'qualified',
  'rejected',
  'disqualified',
]);
const ALLOWED_LEAD_TIERS = new Set(['A', 'B', 'C']);

function asOptionalString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function asNullableString(value: unknown, maxLen: number): string | null | undefined {
  if (value === null) return null;
  return asOptionalString(value, maxLen);
}

function asOptionalInt(value: unknown, opts: { min: number; max: number }): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.trunc(value);
  if (n < opts.min || n > opts.max) return undefined;
  return n;
}

function asNullableIsoDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function asNullableTier(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toUpperCase();
  if (!v) return undefined;
  if (!ALLOWED_LEAD_TIERS.has(v)) return undefined;
  return v;
}

function asStatus(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (!ALLOWED_LEAD_STATUSES.has(v)) return undefined;
  return v;
}

function validateEmail(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (v.length > 254) return undefined;
  if (!v.includes('@') || v.startsWith('@') || v.endsWith('@')) return undefined;
  return v;
}

function makeLeadId(): string {
  return `lead_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get("real") === "true";

  if (searchParams.get("funnel") === "true") {
    return NextResponse.json(getLeadFunnel({ excludeSeed: real }));
  }

  const leads = getLeads({
    status: searchParams.get("status") || undefined,
    tier: searchParams.get("tier") || undefined,
    segment: searchParams.get("segment") || undefined,
    sort: searchParams.get("sort") || undefined,
    order: (searchParams.get("order") as "asc" | "desc") || undefined,
    excludeSeed: real,
  });
  return NextResponse.json(leads);
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);

  const body = await req.json();

  const statusInput = asStatus(body?.status);
  if (body?.status !== undefined && statusInput === undefined) {
    return NextResponse.json({ error: 'Invalid lead status' }, { status: 400 });
  }
  const status = statusInput ?? 'new';
  const tier = asNullableTier(body?.tier);
  if (body?.tier !== undefined && tier === undefined) {
    return NextResponse.json({ error: 'Invalid lead tier' }, { status: 400 });
  }

  const createdAtInput = asNullableIsoDate(body?.created_at);
  if (body?.created_at !== undefined && createdAtInput === undefined) {
    return NextResponse.json({ error: 'Invalid created_at' }, { status: 400 });
  }
  const createdAt = createdAtInput ?? new Date().toISOString();

  const nextActionAt = asNullableIsoDate(body?.next_action_at);
  if (body?.next_action_at !== undefined && nextActionAt === undefined) {
    return NextResponse.json({ error: 'Invalid next_action_at' }, { status: 400 });
  }

  const score = asOptionalInt(body?.score, { min: 0, max: 100 });
  if (body?.score !== undefined && score === undefined) {
    return NextResponse.json({ error: 'Invalid score' }, { status: 400 });
  }

  const email = validateEmail(body?.email);
  if (body?.email !== undefined && email === undefined) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const id = makeLeadId();
  const lead = {
    id,
    first_name: asNullableString(body?.first_name, 80) ?? null,
    last_name: asNullableString(body?.last_name, 80) ?? null,
    title: asNullableString(body?.title, 120) ?? null,
    company: asNullableString(body?.company, 160) ?? null,
    company_size: asNullableString(body?.company_size, 40) ?? null,
    industry_segment: asNullableString(body?.industry_segment, 120) ?? null,
    source: asNullableString(body?.source, 120) ?? null,
    email: email ?? null,
    linkedin_url: asNullableString(body?.linkedin_url, 400) ?? null,
    status,
    score: score ?? null,
    tier: tier ?? null,
    last_touch_at: null as string | null,
    next_action_at: nextActionAt ?? null,
    sequence_name: null as string | null,
    reply_type: null as string | null,
    notes: asNullableString(body?.notes, 20_000) ?? null,
    created_at: createdAt,
    pause_outreach: body?.pause_outreach ? 1 : 0,
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO leads (
      id, first_name, last_name, title, company, company_size, industry_segment,
      source, email, linkedin_url, status, score, tier, last_touch_at, next_action_at,
      sequence_name, reply_type, notes, created_at, pause_outreach
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
  ).run(
    lead.id,
    lead.first_name,
    lead.last_name,
    lead.title,
    lead.company,
    lead.company_size,
    lead.industry_segment,
    lead.source,
    lead.email,
    lead.linkedin_url,
    lead.status,
    lead.score,
    lead.tier,
    lead.last_touch_at,
    lead.next_action_at,
    lead.sequence_name,
    lead.reply_type,
    lead.notes,
    lead.created_at,
    lead.pause_outreach,
  );

  writebackLeadCreate(lead);
  logAudit({
    actor,
    action: 'lead.create',
    target: `lead:${lead.id}`,
    detail: { lead: { id: lead.id, status: lead.status, tier: lead.tier } },
  });

  return NextResponse.json({ ok: true, lead });
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const body = await req.json();

  const id = asOptionalString(body?.id, 200);
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Back-compat: allow status-only updates.
  const status = asStatus(body?.status);
  if (body?.status !== undefined && status === undefined) {
    return NextResponse.json({ error: 'Invalid lead status' }, { status: 400 });
  }

  const tier = asNullableTier(body?.tier);
  if (body?.tier !== undefined && tier === undefined) {
    return NextResponse.json({ error: 'Invalid lead tier' }, { status: 400 });
  }

  const score = asOptionalInt(body?.score, { min: 0, max: 100 });
  if (body?.score !== undefined && score === undefined) {
    return NextResponse.json({ error: 'Invalid score' }, { status: 400 });
  }

  const nextActionAt = asNullableIsoDate(body?.next_action_at);
  if (body?.next_action_at !== undefined && nextActionAt === undefined) {
    return NextResponse.json({ error: 'Invalid next_action_at' }, { status: 400 });
  }

  const email = validateEmail(body?.email);
  if (body?.email !== undefined && email === undefined) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const cols: string[] = [];
  const params: unknown[] = [];

  function add(col: string, val: unknown) {
    cols.push(`${col} = ?`);
    params.push(val);
  }

  if (status !== undefined) { add('status', status); updates.status = status; }
  if (tier !== undefined) { add('tier', tier); updates.tier = tier; }
  if (score !== undefined) { add('score', score); updates.score = score; }
  if (body?.pause_outreach !== undefined) {
    const v = body.pause_outreach ? 1 : 0;
    add('pause_outreach', v);
    updates.pause_outreach = v;
  }
  if (nextActionAt !== undefined) { add('next_action_at', nextActionAt); updates.next_action_at = nextActionAt; }

  const firstName = asNullableString(body?.first_name, 80);
  if (body?.first_name !== undefined && firstName === undefined) {
    return NextResponse.json({ error: 'Invalid first_name' }, { status: 400 });
  }
  if (firstName !== undefined) { add('first_name', firstName); updates.first_name = firstName; }

  const lastName = asNullableString(body?.last_name, 80);
  if (body?.last_name !== undefined && lastName === undefined) {
    return NextResponse.json({ error: 'Invalid last_name' }, { status: 400 });
  }
  if (lastName !== undefined) { add('last_name', lastName); updates.last_name = lastName; }

  const title = asNullableString(body?.title, 120);
  if (body?.title !== undefined && title === undefined) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }
  if (title !== undefined) { add('title', title); updates.title = title; }

  const company = asNullableString(body?.company, 160);
  if (body?.company !== undefined && company === undefined) {
    return NextResponse.json({ error: 'Invalid company' }, { status: 400 });
  }
  if (company !== undefined) { add('company', company); updates.company = company; }

  const companySize = asNullableString(body?.company_size, 40);
  if (body?.company_size !== undefined && companySize === undefined) {
    return NextResponse.json({ error: 'Invalid company_size' }, { status: 400 });
  }
  if (companySize !== undefined) { add('company_size', companySize); updates.company_size = companySize; }

  const industrySegment = asNullableString(body?.industry_segment, 120);
  if (body?.industry_segment !== undefined && industrySegment === undefined) {
    return NextResponse.json({ error: 'Invalid industry_segment' }, { status: 400 });
  }
  if (industrySegment !== undefined) { add('industry_segment', industrySegment); updates.industry_segment = industrySegment; }

  const source = asNullableString(body?.source, 120);
  if (body?.source !== undefined && source === undefined) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }
  if (source !== undefined) { add('source', source); updates.source = source; }

  if (email !== undefined) { add('email', email); updates.email = email; }

  const linkedinUrl = asNullableString(body?.linkedin_url, 400);
  if (body?.linkedin_url !== undefined && linkedinUrl === undefined) {
    return NextResponse.json({ error: 'Invalid linkedin_url' }, { status: 400 });
  }
  if (linkedinUrl !== undefined) { add('linkedin_url', linkedinUrl); updates.linkedin_url = linkedinUrl; }

  const notes = asNullableString(body?.notes, 20_000);
  if (body?.notes !== undefined && notes === undefined) {
    return NextResponse.json({ error: 'Invalid notes' }, { status: 400 });
  }
  if (notes !== undefined) { add('notes', notes); updates.notes = notes; }

  if (cols.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  cols.push("last_touch_at = datetime('now')");

  const db = getDb();
  const before = db.prepare('SELECT id FROM leads WHERE id = ?').get(id) as { id: string } | undefined;
  if (!before) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  params.push(id);
  db.prepare(`UPDATE leads SET ${cols.join(', ')} WHERE id = ?`).run(...params);

  if (status) {
    updateLeadStatus(id, status);
    writebackLeadStatus(id, status);
  }

  writebackLeadUpdate(id, updates);
  logAudit({
    actor,
    action: 'lead.update',
    target: `lead:${id}`,
    detail: { updates },
  });

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, lead });
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);

  const body = await req.json().catch(() => ({}));
  const id = asOptionalString(body?.id, 200) || asOptionalString(req.nextUrl.searchParams.get('id'), 200);
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const db = getDb();
  const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(id) as { id: string } | undefined;
  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM seed_registry WHERE table_name = 'sequences' AND record_id IN (SELECT id FROM sequences WHERE lead_id = ?)").run(id);
    db.prepare('DELETE FROM sequences WHERE lead_id = ?').run(id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(id);
    db.prepare("DELETE FROM seed_registry WHERE table_name = 'leads' AND record_id = ?").run(id);
  });
  tx();

  writebackLeadDelete(id);
  logAudit({
    actor,
    action: 'lead.delete',
    target: `lead:${id}`,
    detail: null,
  });
  return NextResponse.json({ ok: true });
}
