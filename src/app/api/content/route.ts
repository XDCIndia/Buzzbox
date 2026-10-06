import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getContentPostById, getContentPosts, createBuzzContentDraft, markContentPublished, updateContentStatus } from '@/lib/queries';
import { writebackContentStatus } from '@/lib/writeback';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { maybePublishToX } from '@/lib/publish-to-x';
import { z } from 'zod';
import { parseAndValidate } from '@/lib/api-validate';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get('real') === 'true';
  const posts = getContentPosts({
    status: searchParams.get('status') || undefined,
    platform: searchParams.get('platform') || undefined,
    pillar: searchParams.get('pillar') ? Number(searchParams.get('pillar')) : undefined,
    excludeSeed: real,
  });
  return NextResponse.json(posts);
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const parsed = await parseAndValidate(
    req,
    z.object({
      id: z.string().min(1),
      status: z.enum(['draft', 'pending_approval', 'ready', 'rejected', 'published', 'scheduled']),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const { id, status } = parsed.data;

  const current = getContentPostById(id);
  if (!current) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Approving a queued X post is the moment it actually needs to go out --
  // wire the real post here rather than just flipping a status flag.
  const publishResult = await maybePublishToX({
    contentId: id,
    platform: current.platform,
    previousStatus: current.status,
    nextStatus: status,
    text: current.full_content || current.text_preview,
    // Strict per-user isolation: the approver's OWN X account, or the
    // explicitly shared X_ACCESS_TOKEN env sender. Never another user's account.
    userId: actor.id === 0 ? null : actor.id,
  });
  if (publishResult.attempted && !publishResult.ok) {
    return NextResponse.json({ error: publishResult.error }, { status: publishResult.status });
  }

  const finalStatus = publishResult.attempted && publishResult.ok ? 'published' : status;
  if (finalStatus === 'published' && publishResult.attempted) {
    markContentPublished(id);
  } else {
    updateContentStatus(id, finalStatus);
  }
  writebackContentStatus(id, finalStatus);
  logAudit({
    actor,
    action: 'content.update_status',
    target: `content:${id}`,
    detail: {
      status: finalStatus,
      // Attribution: which X account actually posted (null when the shared
      // env sender was used, or when the post was a de-duplicated replay).
      ...(publishResult.attempted && publishResult.ok
        ? {
            x_post_id: publishResult.tweetId,
            x_user_id: publishResult.xUserId ?? null,
            x_username: publishResult.xUsername ?? null,
          }
        : {}),
    },
  });

  // #85: approvals taken anywhere must reach the approvals history panel,
  // which reads activity_log ('approve'/'reject' rows) — audit_log alone
  // never shows up there.
  if (finalStatus === 'ready' || finalStatus === 'rejected') {
    getDb()
      .prepare("INSERT INTO activity_log (ts, action, detail, result) VALUES (datetime('now'), ?, ?, ?)")
      .run(
        finalStatus === 'ready' ? 'approve' : 'reject',
        `${finalStatus === 'ready' ? 'Approved' : 'Rejected'} content: ${id}${publishResult.attempted && publishResult.ok ? ' (posted to X)' : ''}`,
        finalStatus === 'ready' ? 'Moved to ready/approved' : 'Rejected/cancelled',
      );
  }
  return NextResponse.json({
    ok: true,
    status: finalStatus,
    ...(publishResult.attempted && publishResult.ok ? { x_post_id: publishResult.tweetId } : {}),
  });
}

/**
 * POST /api/content — create a manual content draft (no LLM/Buzz required).
 * Uses the same createBuzzContentDraft() backend the Buzz flow uses, so the
 * record enters the normal Draft -> Approval -> Publish pipeline with
 * status 'draft'. Never publishes: publishing happens only through the
 * existing PATCH approval transition.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const parsed = await parseAndValidate(
    req,
    z.object({
      text: z.string().trim().min(1, 'Post text is required').max(5000, 'Post text is too long'),
      platform: z.enum(['x', 'linkedin', 'blog']),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const { text, platform } = parsed.data;

  const draft = createBuzzContentDraft({ platform, content: text }) as { id: string; platform: string; status: string } | undefined;
  if (!draft) {
    return NextResponse.json({ error: 'Could not create the content draft' }, { status: 500 });
  }
  logAudit({
    actor,
    action: 'content.create_draft',
    target: `content:${draft.id}`,
    detail: { platform: draft.platform, status: draft.status },
  });
  return NextResponse.json({ ok: true, draft }, { status: 201 });
}
