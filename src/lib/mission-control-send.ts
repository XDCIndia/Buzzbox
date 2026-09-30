import { getDb, runInTransaction } from './db';

/** Minimum seconds between mission-control sends from the same actor. */
export const MISSION_CONTROL_COOLDOWN_SEC = 3;
/** Sliding window for the per-actor send cap. */
export const MISSION_CONTROL_WINDOW_SEC = 300;
/** Max sends per actor per window. Each accepted send spawns a ~120s agent
 * child, so the cap bounds how many children one actor can create. */
export const MISSION_CONTROL_MAX_PER_WINDOW = 30;

const RATE_KEY_PATTERN = '%"source":"mission-control"%';

export type MissionControlMode = 'orchestrator' | 'agent_bridge';

export interface MissionControlSend {
  username: string;
  conversationId: string;
  /** messages.to_agent value: 'orchestrator' or the target agent id. */
  toAgent: string;
  content: string;
  mode: MissionControlMode;
  fromAgent?: string | null;
  toAgentName?: string | null;
}

export interface MissionControlReceipt {
  metadata: string;
  createdAt: number;
}

/** True when err is a cooldown/cap refusal (callers answer 429). */
export function isMissionControlRateLimit(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  return msg.startsWith('Cooldown active.') || msg.startsWith('Rate limit exceeded for mission-control');
}

/** Atomically check the per-actor cooldown/cap and record the send.
 *
 * The old route code ran the cooldown SELECT, the window COUNT, and the
 * INSERT as three separate statements: N parallel requests all read stale
 * counts, all passed, and each spawned a 120-second agent child (#168).
 * Here guard + insert run in one IMMEDIATE transaction with no awaits
 * inside, so concurrent senders serialize on the write lock — the loser
 * sees the winner's row and is refused instead of spawning another child.
 * The user-message INSERT itself is the claim; no extra table needed.
 *
 * Throws the historical cooldown/cap Error messages (429) on refusal.
 */
export function claimMissionControlSend(send: MissionControlSend): MissionControlReceipt {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const metadata = JSON.stringify({
    source: 'mission-control',
    mode: send.mode,
    actor: send.username,
    from_agent: send.fromAgent ?? null,
    to_agent: send.toAgentName ?? null,
  });
  runInTransaction(db, () => {
    const last = db.prepare(
      `SELECT created_at
       FROM messages
       WHERE from_agent = ? AND metadata LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(send.username, RATE_KEY_PATTERN) as { created_at?: number } | undefined;
    const lastTs = Number(last?.created_at ?? 0);
    if (lastTs > 0 && now - lastTs < MISSION_CONTROL_COOLDOWN_SEC) {
      throw new Error(
        `Cooldown active. Please wait ${MISSION_CONTROL_COOLDOWN_SEC - (now - lastTs)}s before sending another command.`,
      );
    }
    const recentCountRow = db.prepare(
      `SELECT COUNT(*) as c
       FROM messages
       WHERE from_agent = ? AND metadata LIKE ? AND created_at >= ?`,
    ).get(send.username, RATE_KEY_PATTERN, now - MISSION_CONTROL_WINDOW_SEC) as { c?: number } | undefined;
    if (Number(recentCountRow?.c ?? 0) >= MISSION_CONTROL_MAX_PER_WINDOW) {
      throw new Error('Rate limit exceeded for mission-control sends. Try again in a few minutes.');
    }
    db.prepare(
      `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
       VALUES (?, ?, ?, ?, 'text', ?, ?)`,
    ).run(send.conversationId, send.username, send.toAgent, send.content, metadata, now);
  });
  return { metadata, createdAt: now };
}
