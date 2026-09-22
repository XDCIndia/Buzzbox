import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { requireApiCapability, requireApiUser } from '@/lib/api-auth';
import { getAgentIds } from '@/lib/agent-config';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

interface SessionEntry {
  type: string;
  id: string;
  parentId?: string;
  timestamp: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; thinking?: string; name?: string }>;
    timestamp?: number;
  };
}

/**
 * POST /api/chat/sync-sessions
 * Reads JSONL session transcripts and imports user<->agent conversation turns
 * into the messages table. Tracks progress via session_sync table.
 */
export async function POST(request: Request) {
  const auth = requireApiCapability(request as Request, 'manage_system');
  if (auth) return auth;

  const instance = getInstance(getInstanceId(request));
  const { agentsDir } = resolveOpenClawPaths(instance);

  const db = getDb();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const agentIds = getAgentIds(instance.id);

  for (const agentId of agentIds) {
    const sessionsDir = path.join(agentsDir, agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) continue;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      const sessionId = file.replace('.jsonl', '');
      const conversationId = `session:${instance.id}:${agentId}:${sessionId}`;

      try {
        // Check last sync position
        const syncState = db
          .prepare('SELECT last_offset FROM session_sync WHERE session_file = ?')
          .get(filePath) as { last_offset: number } | undefined;

        const lastOffset = syncState?.last_offset || 0;

        const stat = fs.statSync(filePath);
        if (stat.size <= lastOffset) {
          skipped++;
          continue; // No new data
        }

        // Walk the file as bytes so stored offsets stay byte-accurate (#60).
        // A trailing line without a newline may still be being written, so it
        // is left for the next sync instead of being consumed now.
        const buf = fs.readFileSync(filePath);
        const lineRanges: { text: string; start: number; end: number }[] = [];
        let lineStart = 0;
        while (lineStart < buf.length) {
          const nl = buf.indexOf(0x0a, lineStart); // '\n'
          if (nl === -1) break; // trailing partial line
          lineRanges.push({ text: buf.subarray(lineStart, nl).toString('utf-8'), start: lineStart, end: nl + 1 });
          lineStart = nl + 1;
        }

        const newLines = lineRanges.filter((r) => r.start >= lastOffset);
        if (newLines.length === 0) {
          skipped++; // only an incomplete trailing line was added
          continue;
        }

        // Parse all new message entries
        const messageEntries: Array<{ role: string; text: string; timestamp: string; entryId?: string }> = [];

        for (const { text } of newLines) {
          try {
            const entry: SessionEntry = JSON.parse(text);
            if (entry.type !== 'message' || !entry.message) continue;

            const { role, content: contentBlocks } = entry.message;

            if (role === 'user') {
              const textBlock = contentBlocks?.find((b) => b.type === 'text');
              if (textBlock?.text) {
                messageEntries.push({
                  role: 'user',
                  text: textBlock.text,
                  timestamp: entry.timestamp,
                  entryId: entry.id,
                });
              }
            } else if (role === 'assistant') {
              const textBlocks = contentBlocks?.filter((b) => b.type === 'text') || [];
              const combinedText = textBlocks
                .map((b) => b.text)
                .filter(Boolean)
                .join('\n\n');
              if (combinedText) {
                messageEntries.push({
                  role: 'assistant',
                  text: combinedText,
                  timestamp: entry.timestamp,
                  entryId: entry.id,
                });
              }
            }
          } catch {
            // Skip malformed lines
          }
        }

        // Idempotency guard (#60): skip entries already imported for this
        // conversation even if the stored offset drifted (older syncs stored
        // offsets computed differently).
        const seenRows = db
          .prepare("SELECT json_extract(metadata, '$.entry_id') AS eid FROM messages WHERE conversation_id = ? AND metadata IS NOT NULL")
          .all(conversationId) as { eid: string | null }[];
        const seenEntryIds = new Set(seenRows.map((r) => r.eid).filter((v): v is string => Boolean(v)));

        const toImport = messageEntries.filter((e) => !e.entryId || !seenEntryIds.has(e.entryId));

        if (toImport.length > 0) {
          const insert = db.prepare(`
            INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
            VALUES (?, ?, ?, ?, 'text', ?, ?)
          `);

          const insertMany = db.transaction((entries: typeof toImport) => {
            for (const entry of entries) {
              const ts = Math.floor(new Date(entry.timestamp).getTime() / 1000);
              const fromAgent = entry.role === 'user' ? 'operator' : agentId;
              const toAgent = entry.role === 'user' ? agentId : 'operator';
              const metadata = JSON.stringify({
                source: 'session_sync',
                session_id: sessionId,
                instance: instance.id,
                entry_id: entry.entryId ?? null,
              });

              insert.run(conversationId, fromAgent, toAgent, entry.text, metadata, ts);
              imported++;
            }
          });

          insertMany(toImport);

          // Create notification for new session messages
          const agentLabel = agentId.charAt(0).toUpperCase() + agentId.slice(1);
          const firstUserMsg = toImport.find((e) => e.role === 'user');
          let title = `${agentLabel} session activity`;

          if (firstUserMsg) {
            // [cron:<job-id> <description>] — the old pattern was double-escaped
            // (\\[ instead of \[) and could never match a real title (#60).
            const cronMatch = firstUserMsg.text.match(/\[cron:[\w-]+\s+([^\]]+)\]/);
            if (cronMatch) title = `${agentLabel}: ${cronMatch[1]}`;
            else if (firstUserMsg.text.startsWith('[Telegram')) title = `${agentLabel}: Telegram message`;
          }

          const lastResponse = [...toImport].reverse().find((e) => e.role === 'assistant');
          const preview = lastResponse ? lastResponse.text.slice(0, 120) : `${toImport.length} new messages`;

          db.prepare(`
            INSERT INTO notifications (type, severity, title, message, data)
            VALUES ('session', 'info', ?, ?, ?)
          `).run(
            title,
            preview,
            JSON.stringify({ conversation_id: conversationId, agent_id: agentId, count: toImport.length, instance: instance.id }),
          );
        }

        // Resume from the end of the last complete line — never stat.size,
        // which would consume a trailing partial line that is still being
        // written (#60).
        const newOffset = newLines[newLines.length - 1].end;
        db.prepare(`
          INSERT INTO session_sync (session_file, last_offset, last_synced_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT(session_file) DO UPDATE SET
            last_offset = excluded.last_offset,
            last_synced_at = excluded.last_synced_at
        `).run(filePath, newOffset);
      } catch (err) {
        errors.push(`${instance.id}/${agentId}/${file}: ${err}`);
      }
    }
  }

  return NextResponse.json({
    instance: instance.id,
    imported,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    synced_at: new Date().toISOString(),
  });
}

/**
 * GET /api/chat/sync-sessions — status of sync
 */
export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  const db = getDb();
  const rows = db.prepare('SELECT * FROM session_sync ORDER BY last_synced_at DESC').all();
  return NextResponse.json({ sessions: rows });
}

export const dynamic = 'force-dynamic';

