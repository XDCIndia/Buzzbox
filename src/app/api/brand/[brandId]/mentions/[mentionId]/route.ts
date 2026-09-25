import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor } from '@/lib/api-auth';
import { getBrandMention, patchMention } from '@/lib/brand-queries';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ brandId: string; mentionId: string }> }) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const { brandId, mentionId } = await params;
  const parsed = await parseAndValidate(
    req,
    z.object({
      sentiment: z.string().optional(),
      emotion: z.string().optional(),
      intent: z.string().optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!patchMention(brandId, mentionId, { sentiment: body.sentiment, emotion: body.emotion, intent: body.intent })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(getBrandMention(brandId, mentionId));
}
