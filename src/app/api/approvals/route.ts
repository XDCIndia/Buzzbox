import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { seedFilter } from '@/lib/queries';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;
  try {
    const real = req.nextUrl.searchParams.get('real') === 'true';
    const sfContent = real ? ` ${seedFilter('content_posts')}` : '';
    const sfSeq = real ? ` ${seedFilter('sequences', 's.id')}` : '';

    const db = getDb();

    const content = db.prepare(
      `SELECT id, platform, format, pillar, text_preview, full_content, status,
              scheduled_for, published_at, created_at, image_url
       FROM content_posts
       WHERE status = 'pending_approval'${sfContent}
       ORDER BY created_at ASC`
    ).all() as {
      id: string;
      platform: string;
      format: string;
      pillar: number | null;
      text_preview: string | null;
      full_content: string | null;
      status: string;
      scheduled_for: string | null;
      published_at: string | null;
      created_at: string;
      image_url: string | null;
    }[];

    const sequences = db.prepare(
      `SELECT s.id, s.lead_id, s.sequence_name, s.step, s.subject, s.body, s.status,
              s.tier, s.created_at, l.first_name, l.last_name, l.company
       FROM sequences s
       LEFT JOIN leads l ON s.lead_id = l.id
       WHERE s.status = 'pending_approval'${sfSeq}
       ORDER BY s.created_at ASC`
    ).all() as {
      id: string;
      lead_id: string | null;
      sequence_name: string | null;
      step: number | null;
      subject: string | null;
      body: string | null;
      status: string | null;
      tier: string | null;
      created_at: string;
      first_name: string | null;
      last_name: string | null;
      company: string | null;
    }[];

    return NextResponse.json({
      content,
      sequences,
      total: content.length + sequences.length,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
