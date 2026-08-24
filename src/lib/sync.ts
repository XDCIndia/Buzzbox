import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import { getHermesStateDir } from '@/lib/hermes-state';

const STATE_DIR = getHermesStateDir();
const SYNC_INTERVAL = 30_000; // 30 seconds

let syncTimer: ReturnType<typeof setInterval> | null = null;
let lastActivityLine = 0;

export function startSync() {
  if (syncTimer) return;
  console.log('[sync] Starting sync service, reading from:', STATE_DIR);
  syncAll();
  syncTimer = setInterval(syncAll, SYNC_INTERVAL);
}

export function stopSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export function syncAll() {
  try {
    syncContentQueue();
    syncContentCalendar();
    syncContentMetrics();
    syncEngagementLog();
    syncLinkedInComments();
    syncXResearch();
    syncListeningSignals();
    syncExperimentLog();
    syncExperimentLearnings();
    syncLeads();
    syncSequences();
    syncSuppression();
    syncDailyCounts();
    syncActivityLog();
    console.log('[sync] Sync complete at', new Date().toISOString());
  } catch (err) {
    console.error('[sync] Error:', err);
  }
}

function readJson<T>(filename: string): T | null {
  const fp = path.join(STATE_DIR, filename);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf-8').trim();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[sync] Failed to parse ${filename}`);
    return null;
  }
}

// ─── Content Queue ─────────────────────────────────────
interface ContentQueueItem {
  id?: string;
  platform?: string;
  format?: string;
  pillar?: number;
  text?: string;
  full_content?: string;
  status?: string;
  scheduled_for?: string;
}

function syncContentQueue() {
  const items = readJson<ContentQueueItem[]>('content-queue.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO content_posts (id, platform, format, pillar, text_preview, full_content, status, scheduled_for)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      scheduled_for = excluded.scheduled_for,
      text_preview = excluded.text_preview,
      full_content = excluded.full_content
  `);
  const run = db.transaction(() => {
    for (const item of items) {
      if (!item.id) continue;
      upsert.run(
        item.id,
        item.platform || 'x',
        item.format || 'short_post',
        item.pillar || null,
        item.text?.slice(0, 280) || null,
        item.full_content ? JSON.stringify(item.full_content) : item.text || null,
        item.status || 'draft',
        item.scheduled_for || null,
      );
    }
  });
  run();
}

// ─── Content Calendar ──────────────────────────────────
interface CalendarItem {
  id?: string;
  published_at?: string;
  platform?: string;
}

function syncContentCalendar() {
  const items = readJson<CalendarItem[]>('content-calendar.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const update = db.prepare(`
    UPDATE content_posts SET published_at = ?, status = 'published'
    WHERE id = ? AND published_at IS NULL
  `);
  db.transaction(() => {
    for (const item of items) {
      if (!item.id || !item.published_at) continue;
      update.run(item.published_at, item.id);
    }
  })();
}

// ─── Content Metrics ───────────────────────────────────
interface MetricsItem {
  id?: string;
  impressions?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  saves?: number;
  engagement_rate?: number;
}

function syncContentMetrics() {
  const items = readJson<MetricsItem[]>('content-metrics.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const update = db.prepare(`
    UPDATE content_posts SET
      impressions = ?, likes = ?, replies = ?,
      reposts = ?, saves = ?, engagement_rate = ?
    WHERE id = ?
  `);
  db.transaction(() => {
    for (const item of items) {
      if (!item.id) continue;
      update.run(
        item.impressions || 0, item.likes || 0, item.replies || 0,
        item.reposts || 0, item.saves || 0, item.engagement_rate || 0,
        item.id,
      );
    }
  })();
}

// ─── Engagement Log ────────────────────────────────────
interface EngagementItem {
  platform?: string;
  action?: string;
  action_type?: string;
  url?: string;
  target_url?: string;
  username?: string;
  target_username?: string;
  text?: string;
  our_text?: string;
  status?: string;
  timestamp?: string;
  created_at?: string;
}

function syncEngagementLog() {
  const items = readJson<EngagementItem[]>('engagement-log.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO engagements (platform, action_type, target_url, target_username, our_text, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const existing = (db.prepare('SELECT COUNT(*) as c FROM engagements').get() as { c: number })?.c ?? 0;
  if (items.length <= existing) return; // crude dedup: only insert if new items appeared
  db.transaction(() => {
    db.prepare('DELETE FROM engagements WHERE platform != \'linkedin\' OR action_type != \'comment\'').run();
    for (const item of items) {
      insert.run(
        item.platform || 'x',
        item.action_type || item.action || 'reply',
        item.target_url || item.url || null,
        item.target_username || item.username || null,
        item.our_text || item.text || null,
        item.status || 'sent',
        item.created_at || item.timestamp || new Date().toISOString(),
      );
    }
  })();
}

// ─── LinkedIn Comments Queue ───────────────────────────
interface LinkedInComment {
  url?: string;
  target_url?: string;
  username?: string;
  target_username?: string;
  text?: string;
  our_text?: string;
  status?: string;
  timestamp?: string;
}

export function syncLinkedInComments() {
  const items = readJson<LinkedInComment[]>('linkedin-comments-queue.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  // Wipe and rewrite linkedin comments (small list, human-managed)
  db.prepare("DELETE FROM engagements WHERE platform = 'linkedin' AND action_type = 'comment'").run();
  const insert = db.prepare(`
    INSERT INTO engagements (platform, action_type, target_url, target_username, our_text, status, created_at)
    VALUES ('linkedin', 'comment', ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const item of items) {
      insert.run(
        item.target_url || item.url || null,
        item.target_username || item.username || null,
        item.our_text || item.text || null,
        item.status || 'pending',
        item.timestamp || new Date().toISOString(),
      );
    }
  })();
}

// ─── X Research ────────────────────────────────────────
interface ResearchSignal {
  date?: string;
  type?: string;
  username?: string;
  tweet_url?: string;
  url?: string;
  summary?: string;
  relevance?: string;
  action_taken?: string;
  likes?: number;
  impressions?: number;
}

function syncXResearch() {
  const data = readJson<{ signals?: ResearchSignal[]; date?: string }>('x-research-latest.json');
  const items = data?.signals || (Array.isArray(data) ? data : null);
  if (!items) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO signals (date, type, username, tweet_url, summary, relevance, action_taken, likes, impressions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Only insert new ones by checking summary doesn't already exist
  const exists = db.prepare('SELECT 1 FROM signals WHERE summary = ? AND username = ? LIMIT 1');
  db.transaction(() => {
    for (const s of items) {
      if (exists.get(s.summary || '', s.username || '')) continue;
      insert.run(
        s.date || data?.date || new Date().toISOString().slice(0, 10),
        s.type || 'opportunity',
        s.username || null,
        s.tweet_url || s.url || null,
        s.summary || null,
        s.relevance || 'medium',
        s.action_taken || null,
        s.likes || null,
        s.impressions || null,
      );
    }
  })();
}

// ─── Listening Signals ─────────────────────────────────
function syncListeningSignals() {
  // Handle both flat array [...] and wrapped {signals: [...], date: ...} formats
  const raw = readJson<ResearchSignal[] | { signals?: ResearchSignal[]; date?: string }>('listening-signals.json');
  const items = Array.isArray(raw) ? raw : (raw as { signals?: ResearchSignal[] })?.signals;
  if (!items || !Array.isArray(items)) return;
  const wrapperDate = !Array.isArray(raw) ? (raw as { date?: string })?.date : undefined;
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO signals (date, type, username, tweet_url, summary, relevance, action_taken, likes, impressions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const exists = db.prepare('SELECT 1 FROM signals WHERE summary = ? AND username = ? LIMIT 1');
  db.transaction(() => {
    for (const s of items) {
      if (exists.get(s.summary || '', s.username || '')) continue;
      insert.run(
        s.date || wrapperDate || new Date().toISOString().slice(0, 10),
        s.type || 'opportunity',
        s.username || null,
        s.tweet_url || s.url || null,
        s.summary || null,
        s.relevance || 'medium',
        s.action_taken || null,
        s.likes || null,
        s.impressions || null,
      );
    }
  })();
}

// ─── Experiments ───────────────────────────────────────
interface ExperimentItem {
  id?: number;
  week?: number;
  hypothesis?: string;
  action?: string;
  metric?: string;
  win_threshold?: string;
  status?: string;
  results?: unknown;
  winner?: string;
  margin?: string;
  decision?: string;
  learning?: string;
  next_action?: string;
  proposed_at?: string;
  completed_at?: string;
}

export function syncExperimentLog() {
  const items = readJson<ExperimentItem[]>('experiment-log.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  // Reconcile by the source's natural key (hypothesis, week): update rows that
  // already exist (preserving their id), insert genuinely new ones, and leave
  // DB-only rows alone. Experiments have no created_at column and nothing
  // references their id, so identity stability is the only invariant to keep.
  const findId = db.prepare('SELECT id FROM experiments WHERE hypothesis IS ? AND week IS ?');
  const update = db.prepare(`
    UPDATE experiments SET week = ?, hypothesis = ?, action = ?, metric = ?, win_threshold = ?,
      status = ?, results = ?, winner = ?, margin = ?, decision = ?, learning = ?,
      next_action = ?, proposed_at = ?, completed_at = ?
    WHERE id = ?
  `);
  const insert = db.prepare(`
    INSERT INTO experiments (week, hypothesis, action, metric, win_threshold, status, results, winner, margin, decision, learning, next_action, proposed_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const toRow = (e: ExperimentItem) => [
    e.week || null, e.hypothesis || null, e.action || null,
    e.metric || null, e.win_threshold || null, e.status || 'proposed',
    e.results ? JSON.stringify(e.results) : null,
    e.winner || null, e.margin || null, e.decision || null,
    e.learning || null, e.next_action || null,
    e.proposed_at || null, e.completed_at || null,
  ];
  const matched = new Set<number>();
  db.transaction(() => {
    for (const e of items) {
      const row = findId.get(e.hypothesis || null, e.week || null) as { id: number } | undefined;
      if (row && !matched.has(row.id)) {
        matched.add(row.id);
        update.run(...toRow(e), row.id);
      } else {
        insert.run(...toRow(e));
      }
    }
  })();
}

// ─── Learnings ─────────────────────────────────────────
interface LearningItem {
  learning?: string;
  validated_week?: number;
  confidence?: string;
  applied_to?: string[];
}

export function syncExperimentLearnings() {
  const items = readJson<LearningItem[]>('experiment-learnings.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  // Reconcile by the source's natural key (learning, validated_week): refresh
  // confidence/applied_to on existing rows (id and DB-generated created_at
  // stay untouched), insert new ones, and keep DB-only rows.
  const findId = db.prepare('SELECT id FROM learnings WHERE learning IS ? AND validated_week IS ?');
  const update = db.prepare('UPDATE learnings SET confidence = ?, applied_to = ? WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO learnings (learning, validated_week, confidence, applied_to)
    VALUES (?, ?, ?, ?)
  `);
  const matched = new Set<number>();
  db.transaction(() => {
    for (const l of items) {
      const row = findId.get(l.learning || null, l.validated_week || null) as { id: number } | undefined;
      const appliedTo = l.applied_to ? JSON.stringify(l.applied_to) : null;
      if (row && !matched.has(row.id)) {
        matched.add(row.id);
        update.run(l.confidence || null, appliedTo, row.id);
      } else {
        insert.run(l.learning || null, l.validated_week || null, l.confidence || null, appliedTo);
      }
    }
  })();
}

// ─── Leads ─────────────────────────────────────────────
// ICP segment number→name mapping (for legacy skill output)
const ICP_SEGMENTS: Record<number, string> = {
  1: 'AI Agents / Orchestration',
  2: 'Business Automation',
  3: 'Internal Ops Bots',
  4: 'OpenClaw Adjacent',
  5: 'Solana / Crypto',
};

interface LeadItem {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  company_size?: string;
  industry_segment?: string;
  source?: string;
  email?: string;
  linkedin_url?: string;
  status?: string;
  score?: number;
  tier?: string;
  last_touch_at?: string;
  next_action_at?: string;
  sequence_name?: string;
  reply_type?: string;
  notes?: string;
  created_at?: string;
  // Legacy field names from older skill output
  contact_name?: string;
  contact_email?: string;
  contact_title?: string;
  icp_segment?: number;
  discovered_at?: string;
}

function syncLeads() {
  // Handle both flat array [...] and wrapped {leads: [...]} formats
  const raw = readJson<LeadItem[] | { leads?: LeadItem[] }>('leads.json');
  const items = Array.isArray(raw) ? raw : (raw as { leads?: LeadItem[] })?.leads;
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO leads (id, first_name, last_name, title, company, company_size, industry_segment, source, email, linkedin_url, status, score, tier, last_touch_at, next_action_at, sequence_name, reply_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, score = excluded.score, tier = excluded.tier,
      last_touch_at = excluded.last_touch_at, next_action_at = excluded.next_action_at,
      sequence_name = excluded.sequence_name, reply_type = excluded.reply_type, notes = excluded.notes
  `);
  db.transaction(() => {
    for (const l of items) {
      if (!l.id) continue;
      // Normalize legacy field names from older skill output
      const nameParts = l.contact_name?.split(' ') || [];
      const firstName = l.first_name || nameParts[0] || null;
      const lastName = l.last_name || nameParts.slice(1).join(' ') || null;
      const email = l.email || l.contact_email || null;
      const title = l.title || l.contact_title || null;
      const segment = l.industry_segment
        || (typeof l.icp_segment === 'number' ? ICP_SEGMENTS[l.icp_segment] : null)
        || null;
      const createdAt = l.created_at || l.discovered_at || new Date().toISOString();
      upsert.run(
        l.id, firstName, lastName, title,
        l.company || null, l.company_size || null, segment,
        l.source || null, email, l.linkedin_url || null,
        l.status || 'new', l.score || null, l.tier || null,
        l.last_touch_at || null, l.next_action_at || null,
        l.sequence_name || null, l.reply_type || null, l.notes || null,
        createdAt,
      );
    }
  })();
}

// ─── Sequences ─────────────────────────────────────────
interface SequenceItem {
  id?: string;
  lead_id?: string;
  sequence_name?: string;
  step?: number;
  subject?: string;
  body?: string;
  status?: string;
  tier?: string;
  scheduled_for?: string;
  sent_at?: string;
  created_at?: string;
}

function syncSequences() {
  const items = readJson<SequenceItem[]>('sequences.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sequences (id, lead_id, sequence_name, step, subject, body, status, tier, scheduled_for, sent_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, sent_at = excluded.sent_at,
      subject = excluded.subject, body = excluded.body
  `);
  db.transaction(() => {
    for (const s of items) {
      if (!s.id) continue;
      upsert.run(
        s.id, s.lead_id || null, s.sequence_name || null, s.step || null,
        s.subject || null, s.body || null, s.status || 'queued',
        s.tier || null, s.scheduled_for || null, s.sent_at || null,
        s.created_at || new Date().toISOString(),
      );
    }
  })();
}

// ─── Suppression ───────────────────────────────────────
interface SuppressionItem {
  email?: string;
  type?: string;
  added_at?: string;
}

function syncSuppression() {
  const items = readJson<SuppressionItem[]>('suppression.json');
  if (!items || !Array.isArray(items)) return;
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO suppression (email, type, added_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET type = excluded.type
  `);
  db.transaction(() => {
    for (const s of items) {
      if (!s.email) continue;
      upsert.run(s.email, s.type || 'opt_out', s.added_at || new Date().toISOString());
    }
  })();
}

// ─── Daily Counts ──────────────────────────────────────
interface DailyCountsData {
  date?: string;
  [key: string]: unknown;
}

function syncDailyCounts() {
  const data = readJson<DailyCountsData>('daily-counts.json');
  if (!data) return;
  const db = getDb();
  const date = data.date || new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO daily_metrics (date, x_posts, x_threads, linkedin_drafts, x_replies, x_quote_tweets, x_follows, linkedin_comments, discoveries, enrichments, sends, replies_triaged, opt_outs, bounces, total_impressions, total_engagement)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      x_posts = excluded.x_posts, x_threads = excluded.x_threads,
      linkedin_drafts = excluded.linkedin_drafts, x_replies = excluded.x_replies,
      x_quote_tweets = excluded.x_quote_tweets, x_follows = excluded.x_follows,
      linkedin_comments = excluded.linkedin_comments, discoveries = excluded.discoveries,
      enrichments = excluded.enrichments, sends = excluded.sends,
      replies_triaged = excluded.replies_triaged, opt_outs = excluded.opt_outs,
      bounces = excluded.bounces, total_impressions = excluded.total_impressions,
      total_engagement = excluded.total_engagement
  `).run(
    date,
    num(data.x_posts), num(data.x_threads), num(data.linkedin_drafts),
    num(data.x_replies), num(data.x_quote_tweets), num(data.x_follows),
    num(data.linkedin_comments), num(data.discoveries), num(data.enrichments),
    num(data.sends), num(data.replies_triaged), num(data.opt_outs),
    num(data.bounces), num(data.total_impressions), num(data.total_engagement),
  );
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

// ─── Activity Log (JSONL) ──────────────────────────────
function syncActivityLog() {
  const fp = path.join(STATE_DIR, 'activity-log.jsonl');
  try {
    if (!fs.existsSync(fp)) return;
    const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(l => l.trim());
    if (lines.length <= lastActivityLine) return;

    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO activity_log (ts, action, detail, result) VALUES (?, ?, ?, ?)
    `);
    const newLines = lines.slice(lastActivityLine);
    db.transaction(() => {
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line) as { ts?: string; action?: string; detail?: string; result?: string };
          insert.run(entry.ts || null, entry.action || null, entry.detail || null, entry.result || null);
        } catch { /* skip malformed lines */ }
      }
    })();
    lastActivityLine = lines.length;
  } catch {
    console.warn('[sync] Failed to read activity-log.jsonl');
  }
}
