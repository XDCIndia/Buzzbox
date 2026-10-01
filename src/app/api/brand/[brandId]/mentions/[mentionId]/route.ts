import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { getBrandMention, patchMention } from '@/lib/brand-queries';
import { MENTION_EMOTIONS, MENTION_INTENTS, MENTION_SENTIMENTS } from '@/lib/brand-constants';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

/** String enum from a runtime list (single source of truth in
 * brand-constants, shared with the edit UI). */
function strEnum(values: string[]) {
  return z.enum(values as [string, ...string[]]);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ brandId: string; mentionId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, mentionId } = await params;
  const parsed = await parseAndValidate(
    req,
    z.object({
      sentiment: strEnum(MENTION_SENTIMENTS).optional(),
      emotion: strEnum(MENTION_EMOTIONS).optional(),
      intent: strEnum(MENTION_INTENTS).optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!patchMention(brandId, mentionId, { sentiment: body.sentiment, emotion: body.emotion, intent: body.intent })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(getBrandMention(brandId, mentionId));
}
