import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendAgentMessage, sendOrchestratorMessage } from '@/lib/command';
import { requireApiAdmin } from '@/lib/api-auth';
import { requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getAgentIds } from '@/lib/agent-config';
import { parseAndValidate } from '@/lib/api-validate';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Mode = 'orchestrator' | 'agent_bridge';

interface MessageRow {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  message_type: 'text' | 'system';
  metadata: string | null;
  read_at: number | null;
  created_at: number;
}

interface ConversationRow {
  conversation_id: string;
  last_message_at: number;
  message_count: number;
}

function isAgentId(value: unknown, agents: string[]): value is string {
  return typeof value === 'string' && agents.includes(value);
}

function toConversationId(mode: Mode, fromAgent?: string, toAgent?: string): string {
  if (mode === 'orchestrator') return 'mc:orchestrator';
  if (!fromAgent || !toAgent) return 'mc:agent-bridge';
  return `mc:a2a:${fromAgent}:${toAgent}`;
}

function parseBridgeConversation(conversationId: string): { from_agent: string; to_agent: string } | null {
  const match = conversationId.match(/^mc:a2a:([^:]+):([^:]+)$/);
  if (!match) return null;
  return { from_agent: match[1], to_agent: match[2] };
}

export async function GET(request: NextRequest) {
  const auth = requireApiAdmin(request as Request);
  if (auth) return auth;
  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'orchestrator') as Mode;
    const listOnly = request.nextUrl.searchParams.get('list') === 'true';
    const fromAgent = request.nextUrl.searchParams.get('from_agent') || undefined;
    const toAgent = request.nextUrl.searchParams.get('to_agent') || undefined;
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 100)));
    const db = getDb();
    const agents = getAgentIds();

    if (listOnly) {
      const pattern = mode === 'agent_bridge' ? 'mc:a2a:%' : 'mc:orchestrator';
      const rows = db.prepare(
        `SELECT conversation_id, MAX(created_at) as last_message_at, COUNT(*) as message_count
         FROM messages
         WHERE conversation_id LIKE ?
         GROUP BY conversation_id
         ORDER BY last_message_at DESC
         LIMIT 100`,
      ).all(pattern) as ConversationRow[];
      const conversations = rows.map((row) => ({
        ...row,
        ...(parseBridgeConversation(row.conversation_id) || {}),
      }));
      return NextResponse.json({ conversations, agents: agents });
    }

    const conversationId = toConversationId(
      mode === 'agent_bridge' ? 'agent_bridge' : 'orchestrator',
      isAgentId(fromAgent, agents) ? fromAgent : undefined,
      isAgentId(toAgent, agents) ? toAgent : undefined,
    );

    const rows = db.prepare(
      `SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    ).all(conversationId, limit) as MessageRow[];

    const messages = rows.map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));

    return NextResponse.json({ conversation_id: conversationId, messages, agents: agents });
  } catch (error) {
    console.error('mission-control chat fetch error:', error);
    return NextResponse.json({ error: 'Failed to load mission-control chat' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireApiAdmin(request as Request);
  if (auth) return auth;
  try {
    const actor = requireAdmin(request as Request);
    const parsed = await parseAndValidate(
      request,
      z.object({
        mode: z.enum(['orchestrator', 'agent_bridge']).optional(),
        content: z.string().optional(),
        from_agent: z.string().optional(),
        to_agent: z.string().optional(),
        conversation_id: z.string().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const mode: Mode = body.mode === 'agent_bridge' ? 'agent_bridge' : 'orchestrator';
    const content = (body.content || '').trim();
    if (!content) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }

    const fromAgent = body.from_agent;
    const toAgent = body.to_agent;
    const agents = getAgentIds();
    if (mode === 'agent_bridge') {
      if (!isAgentId(fromAgent, agents) || !isAgentId(toAgent, agents)) {
        return NextResponse.json({ error: 'from_agent and to_agent must be valid agent ids' }, { status: 400 });
      }
      if (fromAgent === toAgent) {
        return NextResponse.json({ error: 'from_agent and to_agent must be different' }, { status: 400 });
      }
    }

    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const conversationId = body.conversation_id || toConversationId(mode, fromAgent, toAgent);
    const actorRateKey = `%"source":"mission-control"%`;

    const last = db.prepare(
      `SELECT created_at
       FROM messages
       WHERE from_agent = ? AND metadata LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(actor.username, actorRateKey) as { created_at?: number } | undefined;
    const lastTs = Number(last?.created_at ?? 0);
    const cooldownSec = 3;
    if (lastTs > 0 && now - lastTs < cooldownSec) {
      return NextResponse.json(
        { error: `Cooldown active. Please wait ${cooldownSec - (now - lastTs)}s before sending another command.` },
        { status: 429 },
      );
    }

    const windowSec = 300;
    const maxPerWindow = 30;
    const recentCountRow = db.prepare(
      `SELECT COUNT(*) as c
       FROM messages
       WHERE from_agent = ? AND metadata LIKE ? AND created_at >= ?`,
    ).get(actor.username, actorRateKey, now - windowSec) as { c?: number } | undefined;
    const recentCount = Number(recentCountRow?.c ?? 0);
    if (recentCount >= maxPerWindow) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for mission-control sends. Try again in a few minutes.' },
        { status: 429 },
      );
    }

    const metadata = JSON.stringify({
      source: 'mission-control',
      mode,
      actor: actor.username,
      from_agent: fromAgent ?? null,
      to_agent: toAgent ?? null,
    });

    db.prepare(
      `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
       VALUES (?, ?, ?, ?, 'text', ?, ?)`,
    ).run(conversationId, actor.username, mode === 'agent_bridge' ? toAgent : 'orchestrator', content, metadata, now);

    let responseText = '';
    if (mode === 'orchestrator') {
      const result = await sendOrchestratorMessage(content);
      responseText = result.response;
    } else {
      const bridgedPrompt = `Message from ${fromAgent}: ${content}`;
      const result = await sendAgentMessage(toAgent as string, bridgedPrompt);
      responseText = result.response;
    }

    if (responseText) {
      db.prepare(
        `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
         VALUES (?, ?, ?, ?, 'text', ?, ?)`,
      ).run(
        conversationId,
        mode === 'orchestrator' ? 'orchestrator' : (toAgent as string),
        actor.username,
        responseText,
        metadata,
        Math.floor(Date.now() / 1000),
      );
    }

    logAudit({
      actor,
      action: mode === 'orchestrator' ? 'mission_control.orchestrator_message' : 'mission_control.agent_bridge_message',
      target: conversationId,
      detail: {
        mode,
        from_agent: fromAgent ?? null,
        to_agent: toAgent ?? null,
      },
    });

    return NextResponse.json({ ok: true, conversation_id: conversationId });
  } catch (error) {
    console.error('mission-control send error:', error);
    return NextResponse.json({ error: 'Mission-control send failed' }, { status: 500 });
  }
}
