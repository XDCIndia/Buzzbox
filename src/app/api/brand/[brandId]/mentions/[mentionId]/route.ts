import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { getBrandMention, patchMention } from '@/lib/brand-queries';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ mentionId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { mentionId } = await params;
  const body = await req.json();
  patchMention(mentionId, { sentiment: body.sentiment, emotion: body.emotion, intent: body.intent });
  return NextResponse.json(getBrandMention(mentionId));
}
