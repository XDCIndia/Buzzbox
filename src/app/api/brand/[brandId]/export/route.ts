import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getBrandMentions } from '@/lib/brand-queries';

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ brandId: string }> }) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { brandId } = await params;
  const { searchParams } = req.nextUrl;

  const mentions = getBrandMentions({
    brand_id: brandId,
    source_type: searchParams.get('source_type') || undefined,
    excludeSeed: searchParams.get('real') === 'true',
    sort: 'newest',
  });

  const columns: (keyof typeof mentions[number])[] = [
    'published_at', 'source_type', 'platform', 'author_name', 'author_handle',
    'author_reach', 'text', 'url', 'likes', 'comments', 'sentiment', 'emotion', 'intent',
  ];
  const header = columns.join(',');
  const rows = mentions.map(m => columns.map(c => csvEscape(m[c])).join(','));
  const csv = [header, ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mentions-${brandId}.csv"`,
    },
  });
}
