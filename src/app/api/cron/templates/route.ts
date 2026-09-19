import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { updateCronTemplate, createCronTemplate, deleteCronTemplate, listCronTemplates } from '@/lib/cron-templates';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;

  try {
    const actor = requireUser(req as unknown as Request);
    const templates = listCronTemplates(100);
    const can_write = actor.role === 'admin' || actor.role === 'editor';
    return NextResponse.json({ templates, can_write });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  const actor = requireUser(req as unknown as Request);

  try {
    const parsed = await parseAndValidate(
      req,
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        job: z.record(z.string(), z.unknown()).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as Record<string, unknown>;
    const created = createCronTemplate({
      name: body?.name as string,
      description: body?.description as string | undefined,
      job: body?.job as Record<string, unknown> | undefined,
    });

    logAudit({
      actor,
      action: 'cron_template.create',
      target: `cron_template:${created.id}`,
      detail: { name: created.name },
    });

    return NextResponse.json({ ok: true, template: created });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    if (/^(Invalid |Not found0Template job |Template name )/.test(msg)) {
      const status = msg === 'Not found' ? 404 : msg.includes('exists') ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
    console.error('cron templates error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  const actor = requireUser(req as unknown as Request);

  try {
    const parsed = await parseAndValidate(
      req,
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        job: z.record(z.string(), z.unknown()).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as Record<string, unknown>;
    const updated = updateCronTemplate({
      id: body?.id as string | undefined,
      name: body?.name as string | undefined,
      description: body?.description as string | undefined,
      job: body?.job as Record<string, unknown> | undefined,
    });

    logAudit({
      actor,
      action: 'cron_template.update',
      target: `cron_template:${updated.id}`,
      detail: { name: updated.name },
    });

    return NextResponse.json({ ok: true, template: updated });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    if (/^(Invalid |Not found0Template job |Template name )/.test(msg)) {
      const status = msg === 'Not found' ? 404 : msg.includes('exists') ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
    console.error('cron templates error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  const actor = requireUser(req as unknown as Request);

  try {
    const id = req.nextUrl.searchParams.get('id');
    deleteCronTemplate(id);

    logAudit({
      actor,
      action: 'cron_template.delete',
      target: id ? `cron_template:${id}` : 'cron_template:unknown',
      detail: null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    if (/^(Invalid |Not found0Template job |Template name )/.test(msg)) {
      const status = msg === 'Not found' ? 404 : msg.includes('exists') ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
    console.error('cron templates error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

