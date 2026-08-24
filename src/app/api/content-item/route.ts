import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { getHermesStateDir } from '@/lib/hermes-state';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { maybePublishToX } from '@/lib/publish-to-x';

export const dynamic = 'force-dynamic';

const STATE_DIR = getHermesStateDir();
const QUEUE_FILE = path.join(STATE_DIR, 'content-queue.json');

type QueueItem = Record<string, unknown> & { id?: string };

function readQueueFile(): QueueItem[] {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  const raw = fs.readFileSync(QUEUE_FILE, 'utf-8').trim();
  if (!raw) return [];
  const data = JSON.parse(raw);
  return Array.isArray(data) ? (data as QueueItem[]) : [];
}

function writeQueueFile(items: QueueItem[]) {
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function writeItemToQueueFile(item: QueueItem) {
  try {
    const items = readQueueFile();
    const idx = items.findIndex((x) => x?.id === item.id);
    if (idx >= 0) {
      items[idx] = item;
    } else {
      items.unshift(item);
    }
    writeQueueFile(items);
  } catch {
    // compatibility writeback only
  }
}

function computePreviewAndFull(item: QueueItem): { preview: string | null; full: string | null } {
  let preview = (item.text as string | undefined) || (item.body as string | undefined) || (item.topic as string | undefined) || null;
  let full = (item.full_content as string | undefined) || (item.text as string | undefined) || (item.body as string | undefined) || null;

  const slides = item.slides as unknown;
  const tweets = item.tweets as unknown;

  if (Array.isArray(slides) && slides.length > 0) {
    const first = slides[0] as { text?: string } | string;
    if (!preview) preview = (typeof first === 'string' ? first : first?.text) || null;
    full = slides
      .map((s) => (typeof s === 'string' ? s : (s as { text?: string })?.text))
      .filter(Boolean)
      .join('\n\n---\n\n');
  } else if (Array.isArray(tweets) && tweets.length > 0) {
    const first = tweets[0] as { text?: string } | string;
    if (!preview) preview = (typeof first === 'string' ? first : first?.text) || null;
    full = tweets
      .map((t) => (typeof t === 'string' ? t : (t as { text?: string })?.text))
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  return {
    preview: preview ? String(preview).slice(0, 280) : null,
    full: full ? String(full) : null,
  };
}

function extractImageUrl(item: QueueItem): string | null {
  const direct = (item.image_url as string | undefined) || (item.imageUrl as string | undefined);
  if (direct) return String(direct);
  const image = (item.image as { url?: string } | undefined) || null;
  if (image?.url) return String(image.url);
  return null;
}

function rowToQueueItem(row: Record<string, unknown>): QueueItem {
  const queueJson = row.queue_json as string | null | undefined;
  if (queueJson) {
    try {
      const parsed = JSON.parse(queueJson) as QueueItem;
      if (parsed?.id) return parsed;
    } catch {
      // fall through to synthesized object
    }
  }

  return {
    id: row.id as string,
    platform: row.platform as string,
    format: row.format as string,
    pillar: row.pillar as number | null,
    text: row.text_preview as string | null,
    full_content: row.full_content as string | null,
    status: row.status as string,
    scheduled_for: row.scheduled_for as string | null,
    image_url: row.image_url as string | null,
  };
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM content_queue_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (row) return NextResponse.json({ item: rowToQueueItem(row) });

    // Fallback for legacy deployments not yet synced to DB queue
    const fileItem = readQueueFile().find((x) => x?.id === id);
    if (fileItem) return NextResponse.json({ item: fileItem });

    return NextResponse.json({ error: 'not found' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  try {
    const body = (await req.json()) as {
      id?: string;
      patch?: Record<string, unknown>;
      item?: QueueItem;
    };

    const id = body?.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const db = getDb();
    const row = db.prepare('SELECT * FROM content_queue_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    const current = row ? rowToQueueItem(row) : readQueueFile().find((x) => x?.id === id);
    if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });

    let updated: QueueItem;
    if (body.item) {
      if (body.item?.id !== id) {
        return NextResponse.json({ error: 'item.id must match id' }, { status: 400 });
      }
      updated = body.item;
    } else if (body.patch && typeof body.patch === 'object') {
      updated = { ...current, ...body.patch };
      const patchAny = body.patch as { scheduled_for?: unknown; status?: unknown };
      if (patchAny.scheduled_for === null && patchAny.status == null && current.status === 'ready') {
        updated.status = 'pending_approval';
      }
    } else {
      return NextResponse.json({ error: 'patch or item required' }, { status: 400 });
    }

    const parsed = computePreviewAndFull(updated);
    const imageUrl = extractImageUrl(updated);
    const platform = (updated.platform as string | undefined) || 'x';
    const format = (updated.format as string | undefined) || 'short_post';
    const pillar = (updated.pillar as number | null | undefined) ?? null;
    let status = (updated.status as string | undefined) || 'draft';
    const scheduledFor = (updated.scheduled_for as string | null | undefined) ?? null;

    // Approving/publishing a queued X item is the moment it actually needs
    // to go out -- wire the real post here rather than just flipping a status flag.
    const publishResult = await maybePublishToX({
      platform,
      previousStatus: (current.status as string | undefined) ?? null,
      nextStatus: status,
      text: parsed.full || parsed.preview,
    });
    if (publishResult.attempted && !publishResult.ok) {
      return NextResponse.json({ error: publishResult.error }, { status: publishResult.status });
    }
    if (publishResult.attempted && publishResult.ok) {
      status = 'published';
      updated.status = status;
    }

    const queueJson = JSON.stringify(updated);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO content_queue_items (
          id, platform, format, pillar, text_preview, full_content, image_url, status, scheduled_for, queue_json, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dashboard', CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          format = excluded.format,
          pillar = excluded.pillar,
          text_preview = excluded.text_preview,
          full_content = excluded.full_content,
          image_url = excluded.image_url,
          status = excluded.status,
          scheduled_for = excluded.scheduled_for,
          queue_json = excluded.queue_json,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        id, platform, format, pillar, parsed.preview, parsed.full, imageUrl, status, scheduledFor, queueJson,
      );

      db.prepare(`
        INSERT INTO content_posts (
          id, platform, format, pillar, text_preview, full_content, image_url, status, scheduled_for
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          format = excluded.format,
          pillar = excluded.pillar,
          text_preview = excluded.text_preview,
          full_content = excluded.full_content,
          image_url = excluded.image_url,
          status = excluded.status,
          scheduled_for = excluded.scheduled_for
      `).run(
        id, platform, format, pillar, parsed.preview, parsed.full, imageUrl, status, scheduledFor,
      );
    })();

    // Backward compatibility for workers still reading file queue.
    writeItemToQueueFile(updated);

    return NextResponse.json({ ok: true, item: updated });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
