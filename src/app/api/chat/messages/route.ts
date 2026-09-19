import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendAgentMessage } from '@/lib/command';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getAgentIds } from '@/lib/agent-config';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { parseAndValidate } from '@/lib/api-validate';
import { clampParam } from '@/lib/query-params';
import { z } from 'zod';

export const dynamic = 'force-dynamic';


interface MessageRow {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  message_type: string;
  metadata: string | null;
  created_at: number;
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  try {
    const db = getDb();
    const { searchParams } = req.nextUrl;

    const conversation_id = searchParams.get('conversation_id');
    const limit = clampParam(req, 'limit', 1, 200, 50);
    const since = searchParams.get('since');

    let sql = 'SELECT * FROM messages WHERE 1=1';
    const params: unknown[] = [];

    if (conversation_id) { sql += ' AND conversation_id = ?'; params.push(conversation_id); }
    if (since) { sql += ' AND created_at > ?'; params.push(Number(since)); }

    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit);

    const messages = db.prepare(sql).all(...params) as MessageRow[];
    const parsed = messages.map(m => ({
      ...m,
      metadata: m.metadata ? JSON.parse(m.metadata) : null,
    }));

    return NextResponse.json({ messages: parsed });
  } catch (error) {
    console.error('GET /api/chat/messages error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  try {
    const actor = requireUser(req as Request);
    const db = getDb();
    const parsed = await parseAndValidate(
      req,
      z.object({
        content: z.string(),
        to: z.string().optional(),
        message_type: z.string().optional(),
        conversation_id: z.string().optional(),
        forward: z.boolean().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const from = (typeof actor?.username === 'string' && actor.username.trim()) ? actor.username.trim() : 'operator';
    const to = body.to ? (body.to as string).trim() : null;
    const content = (body.content || '').trim();
    const message_type = body.message_type || 'text';
    const conversation_id = body.conversation_id || `conv_${Date.now()}`;

    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    // Save the human message
    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = Math.floor(Date.now() / 1000);
    const result = stmt.run(conversation_id, from, to, content, message_type, now);
    const messageId = result.lastInsertRowid as number;

    const created = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRow | undefined;
    if (!created) {
      return NextResponse.json({ error: 'Failed to load created message' }, { status: 500 });
    }
    const parsedMessage = { ...created, metadata: null };

    logAudit({
      actor,
      action: 'chat.message.send',
      target: `conversation:${conversation_id}`,
      detail: { from, to, message_type },
    });

    // If recipient is a known agent, forward via gateway (async, non-blocking)
    if (to && getAgentIds().includes(to) && body.forward !== false) {
      // Fire-and-forget: forward to agent, save response when it comes back
      forwardToAgent(db, to, content, conversation_id, from).catch(err => {
        console.error(`Failed to forward to ${to}:`, err);
        // Save error as system message
        db.prepare(`
          INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, created_at)
          VALUES (?, 'system', ?, ?, 'system', ?)
        `).run(conversation_id, from, `Failed to reach ${to}: ${(err as Error).message?.slice(0, 200)}`, Math.floor(Date.now() / 1000));
      });
    }

    return NextResponse.json({ message: parsedMessage }, { status: 201 });
  } catch (error) {
    console.error('POST /api/chat/messages error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

async function forwardToAgent(
  db: ReturnType<typeof getDb>,
  agentId: string,
  content: string,
  conversationId: string,
  from: string,
) {
  const { response } = await sendAgentMessage(agentId, `Message from ${from}: ${content}`);

  if (response) {
    db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, created_at)
      VALUES (?, ?, ?, ?, 'text', ?)
    `).run(conversationId, agentId, from, response, Math.floor(Date.now() / 1000));
  }
}
