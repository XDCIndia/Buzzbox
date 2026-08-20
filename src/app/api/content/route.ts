import { NextRequest, NextResponse } from 'next/server';
import { getContentPostById, getContentPosts, markContentPublished, updateContentStatus } from '@/lib/queries';
import { writebackContentStatus } from '@/lib/writeback';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { maybePublishToX } from '@/lib/publish-to-x';

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
  const body = await req.json();
  const { id, status } = body;
  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }

  const current = getContentPostById(id);

  // Approving a queued X post is the moment it actually needs to go out --
  // wire the real post here rather than just flipping a status flag.
  const publishResult = await maybePublishToX({
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
  return NextResponse.json({
    ok: true,
    status: finalStatus,
    ...(publishResult.attempted && publishResult.ok ? { x_post_id: publishResult.tweetId } : {}),
  });
}
