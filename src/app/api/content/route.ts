import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getContentPostById, getContentPosts, markContentPublished, updateContentStatus } from '@/lib/queries';
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

  // Approving a queued X post is the moment it actually needs to go out --
  // wire the real post here rather than just flipping a status flag.
  const publishResult = await maybePublishToX({
    contentId: id,
    platform: current?.platform,
    previousStatus: current?.status,
    nextStatus: status,
    text: current?.full_content || current?.text_preview,
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
      ...(publishResult.attempted && publishResult.ok ? { x_post_id: publishResult.tweetId } : {}),
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
