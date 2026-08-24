import { getDb } from './db';
import type {
  ContentPost, Lead, Sequence, Suppression, Engagement,
  Signal, Experiment, Learning, DailyMetrics, ActivityEntry,
  OverviewStats, Alert, FunnelStep, WeeklyKPI, Notification,
} from '@/types';

// ─── Overview ──────────────────────────────────────────
export function getOverviewStats(filters?: { excludeSeed?: boolean }): OverviewStats {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const sf = filters?.excludeSeed ? seedFilter : () => '';

  const posts_today = (db.prepare(
    `SELECT COUNT(*) as c FROM content_posts WHERE (date(published_at) = ? OR date(created_at) = ?) ${sf('content_posts')}`
  ).get(today, today) as { c: number })?.c ?? 0;

  const engagement_today = (db.prepare(
    `SELECT COUNT(*) as c FROM engagements WHERE date(created_at) = ? ${sf('engagements')}`
  ).get(today) as { c: number })?.c ?? 0;

  const emails_sent = (db.prepare(
    `SELECT COUNT(*) as c FROM sequences WHERE status = 'sent' AND date(sent_at) = ? ${sf('sequences')}`
  ).get(today) as { c: number })?.c ?? 0;

  const pipeline_count = (db.prepare(
    `SELECT COUNT(*) as c FROM leads WHERE status IN ('interested', 'booked') ${sf('leads')}`
  ).get() as { c: number })?.c ?? 0;

  return { posts_today, engagement_today, emails_sent, pipeline_count };
}

export function getAlerts(filters?: { excludeSeed?: boolean }): Alert[] {
  const db = getDb();
  const alerts: Alert[] = [];

  const sf = filters?.excludeSeed ? seedFilter : () => '';

  // Bounce rate check
  const metrics = db.prepare(
    `SELECT sends, bounces FROM daily_metrics ORDER BY date DESC LIMIT 1`
  ).get() as { sends: number; bounces: number } | undefined;
  if (metrics && metrics.sends > 0 && (metrics.bounces / metrics.sends) > 0.03) {
    alerts.push({
      id: 'bounce-rate',
      type: 'error',
      message: `Bounce rate at ${((metrics.bounces / metrics.sends) * 100).toFixed(1)}% — exceeds 3% threshold`,
      created_at: new Date().toISOString(),
    });
  }

  // Pending approvals > 24h
  const stale = (db.prepare(
    `SELECT COUNT(*) as c FROM content_posts
     WHERE status = 'pending_approval'
     AND created_at < datetime('now', '-24 hours') ${sf('content_posts')}`
  ).get() as { c: number })?.c ?? 0;
  if (stale > 0) {
    alerts.push({
      id: 'stale-approvals',
      type: 'warning',
      message: `${stale} content item(s) pending approval for >24 hours`,
      created_at: new Date().toISOString(),
    });
  }

  // Stale email approvals
  const staleEmails = (db.prepare(
    `SELECT COUNT(*) as c FROM sequences
     WHERE status = 'pending_approval'
     AND created_at < datetime('now', '-24 hours') ${sf('sequences')}`
  ).get() as { c: number })?.c ?? 0;
  if (staleEmails > 0) {
    alerts.push({
      id: 'stale-email-approvals',
      type: 'warning',
      message: `${staleEmails} email draft(s) pending approval for >24 hours`,
      created_at: new Date().toISOString(),
    });
  }

  // High engagement signal (viral)
  const viral = db.prepare(
    `SELECT summary FROM signals
     WHERE relevance = 'high' AND date(created_at) = date('now') ${sf('signals')}
     ORDER BY created_at DESC LIMIT 1`
  ).get() as { summary: string } | undefined;
  if (viral) {
    alerts.push({
      id: 'viral-signal',
      type: 'info',
      message: `High-relevance signal: ${viral.summary?.slice(0, 80)}...`,
      created_at: new Date().toISOString(),
    });
  }

  // Webhook-pushed notifications (unread, last 24h)
  const notifications = db.prepare(
    `SELECT id, severity, title, message, created_at FROM notifications
     WHERE read = 0 AND created_at > datetime('now', '-24 hours')
     ORDER BY created_at DESC LIMIT 10`
  ).all() as { id: number; severity: string; title: string | null; message: string; created_at: string }[];
  for (const n of notifications) {
    alerts.push({
      id: `notif-${n.id}`,
      type: (n.severity === 'error' ? 'error' : n.severity === 'warning' ? 'warning' : 'info') as Alert['type'],
      message: n.title ? `${n.title}: ${n.message}` : n.message,
      created_at: n.created_at,
    });
  }

  return alerts;
}

// ─── Approvals ─────────────────────────────────────────
export function getPendingApprovals() {
  const db = getDb();

  const content = db.prepare(
    `SELECT id, platform, format, pillar, text_preview,
            full_content, status, scheduled_for,
            created_at, image_url
     FROM content_posts
     WHERE status = 'pending_approval'
     ORDER BY created_at ASC`
  ).all();

  const sequences = db.prepare(
    `SELECT s.id, s.lead_id, s.sequence_name, s.step,
            s.subject, s.body, s.status, s.tier,
            s.created_at, l.first_name, l.last_name,
            l.company
     FROM sequences s
     LEFT JOIN leads l ON s.lead_id = l.id
     WHERE s.status = 'pending_approval'
     ORDER BY s.created_at ASC`
  ).all();

  return {
    content,
    sequences,
    total: content.length + sequences.length,
  };
}

// ─── Content ───────────────────────────────────────────
export function getContentPosts(filters?: {
  status?: string;
  platform?: string;
  pillar?: number;
  excludeSeed?: boolean;
}): ContentPost[] {
  const db = getDb();
  let sql = 'SELECT * FROM content_posts WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters?.platform) { sql += ' AND platform = ?'; params.push(filters.platform); }
  if (filters?.pillar) { sql += ' AND pillar = ?'; params.push(filters.pillar); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('content_posts')}`; }

  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params) as ContentPost[];
}

export function updateContentStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare('UPDATE content_posts SET status = ? WHERE id = ?').run(status, id);
}

export function getContentPostById(id: string): ContentPost | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM content_posts WHERE id = ?').get(id) as ContentPost | undefined;
}

/** Marks a post published (with published_at) -- used once it has actually gone out (e.g. posted to X). */
export function markContentPublished(id: string): void {
  const db = getDb();
  db.prepare("UPDATE content_posts SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

// ─── Leads ─────────────────────────────────────────────
export function getLeads(filters?: {
  status?: string;
  tier?: string;
  segment?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  excludeSeed?: boolean;
}): Lead[] {
  const db = getDb();
  let sql = 'SELECT * FROM leads WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters?.tier) { sql += ' AND tier = ?'; params.push(filters.tier); }
  if (filters?.segment) { sql += ' AND industry_segment = ?'; params.push(filters.segment); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('leads')}`; }

  const sortCol = ['score', 'created_at', 'last_touch_at', 'company'].includes(filters?.sort || '')
    ? filters!.sort
    : 'created_at';
  const order = filters?.order === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sortCol} ${order}`;

  return db.prepare(sql).all(...params) as Lead[];
}

export function updateLeadStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare('UPDATE leads SET status = ?, last_touch_at = datetime(\'now\') WHERE id = ?').run(status, id);
}

export function getLeadFunnel(filters?: { excludeSeed?: boolean }): FunnelStep[] {
  const db = getDb();
  const sf = filters?.excludeSeed ? seedFilter('leads') : '';
  const steps = ["new", "validated", "approved", "contacted", "replied", "interested", "booked", "qualified", "rejected", "disqualified"]; 
  return steps.map(name => {
    const row = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status = ? ${sf}`).get(name) as { c: number };
    return { name, value: row?.c ?? 0 };
  });
}

// ─── Sequences ─────────────────────────────────────────
export function getSequences(filters?: { status?: string; lead_id?: string; excludeSeed?: boolean }): Sequence[] {
  const db = getDb();
  let sql = 'SELECT * FROM sequences WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters?.lead_id) { sql += ' AND lead_id = ?'; params.push(filters.lead_id); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('sequences')}`; }

  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params) as Sequence[];
}

export function updateSequenceStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare('UPDATE sequences SET status = ? WHERE id = ?').run(status, id);
}

// ─── Suppression ───────────────────────────────────────
export function getSuppression(filters?: { excludeSeed?: boolean }): Suppression[] {
  const db = getDb();
  const sf = filters?.excludeSeed ? seedFilter('suppression', 'email') : '';
  return db.prepare(`SELECT * FROM suppression WHERE 1=1 ${sf} ORDER BY added_at DESC`).all() as Suppression[];
}

// ─── Engagement ────────────────────────────────────────
export function getEngagements(filters?: {
  platform?: string;
  action_type?: string;
  date?: string;
  excludeSeed?: boolean;
}): Engagement[] {
  const db = getDb();
  let sql = 'SELECT * FROM engagements WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.platform) { sql += ' AND platform = ?'; params.push(filters.platform); }
  if (filters?.action_type) { sql += ' AND action_type = ?'; params.push(filters.action_type); }
  if (filters?.date) { sql += ' AND date(created_at) = ?'; params.push(filters.date); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('engagements')}`; }

  sql += ' ORDER BY created_at DESC LIMIT 200';
  return db.prepare(sql).all(...params) as Engagement[];
}

// ─── Signals ───────────────────────────────────────────
export function getSignals(filters?: {
  type?: string;
  relevance?: string;
  date?: string;
  excludeSeed?: boolean;
}): Signal[] {
  const db = getDb();
  let sql = 'SELECT * FROM signals WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.type) { sql += ' AND type = ?'; params.push(filters.type); }
  if (filters?.relevance) { sql += ' AND relevance = ?'; params.push(filters.relevance); }
  if (filters?.date) { sql += ' AND date = ?'; params.push(filters.date); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('signals')}`; }

  sql += ' ORDER BY created_at DESC LIMIT 200';
  return db.prepare(sql).all(...params) as Signal[];
}

// ─── Experiments ───────────────────────────────────────
export function getExperiments(filters?: { status?: string; excludeSeed?: boolean }): Experiment[] {
  const db = getDb();
  let sql = 'SELECT * FROM experiments WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('experiments')}`; }

  sql += ' ORDER BY week DESC, id DESC';
  return db.prepare(sql).all(...params) as Experiment[];
}

export function getLearnings(filters?: { excludeSeed?: boolean }): Learning[] {
  const db = getDb();
  const sf = filters?.excludeSeed ? seedFilter('learnings') : '';
  return db.prepare(`SELECT * FROM learnings WHERE 1=1 ${sf} ORDER BY validated_week DESC, id DESC`).all() as Learning[];
}

// ─── KPIs ──────────────────────────────────────────────
export function getDailyMetrics(days: number = 90, filters?: { excludeSeed?: boolean }): DailyMetrics[] {
  const db = getDb();
  const sf = filters?.excludeSeed ? seedFilter('daily_metrics', 'date') : '';
  return db.prepare(
    `SELECT * FROM daily_metrics WHERE 1=1 ${sf} ORDER BY date DESC LIMIT ?`
  ).all(days) as DailyMetrics[];
}

export function getWeeklyKPIs(weeks: number = 12, filters?: { excludeSeed?: boolean }): WeeklyKPI[] {
  const db = getDb();
  const sf = filters?.excludeSeed ? seedFilter('daily_metrics', 'date') : '';
  const metrics = db.prepare(
    `SELECT * FROM daily_metrics WHERE 1=1 ${sf} ORDER BY date DESC LIMIT ?`
  ).all(weeks * 7) as DailyMetrics[];

  // Group by ISO week
  const weekMap = new Map<string, DailyMetrics[]>();
  for (const m of metrics) {
    const d = new Date(m.date);
    const week = getISOWeek(d);
    const key = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(m);
  }

  return Array.from(weekMap.entries()).map(([week, days]) => {
    const totalSends = days.reduce((s, d) => s + d.sends, 0);
    const totalReplies = days.reduce((s, d) => s + d.replies_triaged, 0);
    const totalImpressions = days.reduce((s, d) => s + d.total_impressions, 0);
    const totalEngagement = days.reduce((s, d) => s + d.total_engagement, 0);

    return {
      week,
      leads_added: days.reduce((s, d) => s + d.discoveries, 0),
      emails_sent: totalSends,
      reply_rate: totalSends > 0 ? (totalReplies / totalSends) * 100 : 0,
      positive_reply_rate: 0,
      calls_booked: 0,
      sqls: 0,
      impressions: totalImpressions,
      engagement_rate: totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0,
    };
  }).slice(0, weeks);
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ─── Activity Log ──────────────────────────────────────
export function getActivityLog(filters?: {
  action?: string;
  limit?: number;
  excludeSeed?: boolean;
}): ActivityEntry[] {
  const db = getDb();
  let sql = 'SELECT * FROM activity_log WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.action) { sql += ' AND action = ?'; params.push(filters.action); }
  if (filters?.excludeSeed) { sql += ` ${seedFilter('activity_log')}`; }

  sql += ' ORDER BY ts DESC LIMIT ?';
  params.push(filters?.limit ?? 100);

  return db.prepare(sql).all(...params) as ActivityEntry[];
}

// ─── Notifications ────────────────────────────────────
export function createNotification(data: {
  type: string;
  severity?: string;
  title?: string;
  message: string;
  data?: Record<string, unknown>;
}): number {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO notifications (type, severity, title, message, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    data.type,
    data.severity || 'info',
    data.title || null,
    data.message,
    data.data ? JSON.stringify(data.data) : null,
  );
  return result.lastInsertRowid as number;
}

export function getNotifications(filters?: {
  unread_only?: boolean;
  type?: string;
  limit?: number;
}): Notification[] {
  const db = getDb();
  let sql = 'SELECT * FROM notifications WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.unread_only) { sql += ' AND read = 0'; }
  if (filters?.type) { sql += ' AND type = ?'; params.push(filters.type); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filters?.limit ?? 50);

  const rows = db.prepare(sql).all(...params) as (Omit<Notification, 'data' | 'read'> & { data: string | null; read: number })[];
  return rows.map(r => ({
    ...r,
    read: r.read === 1,
    data: r.data ? JSON.parse(r.data) : null,
  }));
}

export function markNotificationRead(id: number): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
}

export function markAllNotificationsRead(): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
}

// ─── Seed Registry ────────────────────────────────────────
export function isSeedRecord(tableName: string, recordId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM seed_registry WHERE table_name = ? AND record_id = ?'
  ).get(tableName, recordId);
  return !!row;
}

export function getSeedCount(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as c FROM seed_registry').get() as { c: number })?.c ?? 0;
}

/** Returns SQL fragment to exclude seeded records from a query */
export function seedFilter(tableName: string, idColumn: string = 'id'): string {
  return `AND NOT EXISTS (SELECT 1 FROM seed_registry sr WHERE sr.table_name = '${tableName}' AND sr.record_id = CAST(${idColumn} AS TEXT))`;
}

export function createBuzzContentDraft({
  platform,
  content,
}: {
  platform: string;
  content: string;
}) {
  const db = getDb();

  const id = `buzz-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO content_posts (
      id,
      platform,
      format,
      pillar,
      text_preview,
      full_content,
      status,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    platform,
    'post',
    1,
    content.slice(0, 160),
    content,
    'draft',
    now,
  );

  return db.prepare(`
    SELECT *
    FROM content_posts
    WHERE id = ?
  `).get(id);
}