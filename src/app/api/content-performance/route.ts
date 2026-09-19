import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireApiUser } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const db = getDb();

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM content_posts`
    ).get() as { c: number })?.c ?? 0;

    const draft = (db.prepare(
      `SELECT COUNT(*) as c FROM content_posts WHERE status = 'draft'`
    ).get() as { c: number })?.c ?? 0;

    const pending = (db.prepare(
      `SELECT COUNT(*) as c FROM content_posts WHERE status = 'pending_approval'`
    ).get() as { c: number })?.c ?? 0;

    const ready = (db.prepare(
      `SELECT COUNT(*) as c FROM content_posts WHERE status = 'ready'`
    ).get() as { c: number })?.c ?? 0;

    const published = (db.prepare(
      `SELECT COUNT(*) as c FROM content_posts WHERE status = 'published'`
    ).get() as { c: number })?.c ?? 0;

    const published30 = (db.prepare(
      `SELECT COUNT(*) as c FROM content_posts
       WHERE status = 'published' AND date(published_at) >= date('now', '-30 days')`
    ).get() as { c: number })?.c ?? 0;

    const impressions30 = (db.prepare(
      `SELECT SUM(impressions) as v FROM content_posts
       WHERE status = 'published' AND date(published_at) >= date('now', '-30 days')`
    ).get() as { v: number | null })?.v ?? 0;

    const avgEngagement = (db.prepare(
      `SELECT AVG(engagement_rate) as v FROM content_posts
       WHERE status = 'published' AND date(published_at) >= date('now', '-30 days')`
    ).get() as { v: number | null })?.v ?? null;

    const approvalRate = total > 0 ? (ready + published) / total : 0;

    return NextResponse.json({
      total,
      draft,
      pending,
      ready,
      published,
      published_last_30: published30,
      impressions_last_30: impressions30,
      avg_engagement_rate: avgEngagement,
      approval_rate: approvalRate,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
