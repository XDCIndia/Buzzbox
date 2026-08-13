import { getDb } from './db';
import { seedFilter, createNotification } from './queries';
import type {
  Brand, BrandMention, BrandMentionStats, BrandCreator,
  BrandCompetitor, BrandCampaign, BrandAlert, BrandDigest,
} from '@/types';

type BrandRow = Omit<Brand, 'keywords' | 'sources'> & { keywords: string; sources: string };
type MentionRow = Omit<BrandMention, 'is_crisis' | 'is_high_impact'> & { is_crisis: number; is_high_impact: number };

function rowToBrand(row: BrandRow): Brand {
  return { ...row, keywords: JSON.parse(row.keywords || '[]'), sources: JSON.parse(row.sources || '[]') };
}

function rowToMention(row: MentionRow): BrandMention {
  return { ...row, is_crisis: row.is_crisis === 1, is_high_impact: row.is_high_impact === 1 };
}

// ─── Brand ──────────────────────────────────────────────
export function getBrand(id: string): Brand | null {
  const row = getDb().prepare('SELECT * FROM brands WHERE id = ?').get(id) as BrandRow | undefined;
  return row ? rowToBrand(row) : null;
}

export function updateBrand(id: string, data: { name?: string; keywords?: string[]; sources?: string[] }): void {
  const db = getDb();
  const current = getBrand(id);
  if (!current) return;
  db.prepare('UPDATE brands SET name = ?, keywords = ?, sources = ? WHERE id = ?').run(
    data.name ?? current.name,
    JSON.stringify(data.keywords ?? current.keywords),
    JSON.stringify(data.sources ?? current.sources),
    id,
  );
}

// ─── Mentions ───────────────────────────────────────────
export function getBrandMentions(filters: {
  brand_id: string;
  source_type?: string;
  platform?: string[];
  sentiment?: string[];
  search?: string;
  sort?: 'newest' | 'oldest' | 'popular' | 'reach';
  excludeSeed?: boolean;
}): BrandMention[] {
  const db = getDb();
  let sql = 'SELECT * FROM brand_mentions WHERE brand_id = ?';
  const params: unknown[] = [filters.brand_id];

  if (filters.source_type) { sql += ' AND source_type = ?'; params.push(filters.source_type); }
  if (filters.platform?.length) { sql += ` AND platform IN (${filters.platform.map(() => '?').join(',')})`; params.push(...filters.platform); }
  if (filters.sentiment?.length) { sql += ` AND sentiment IN (${filters.sentiment.map(() => '?').join(',')})`; params.push(...filters.sentiment); }
  if (filters.search) { sql += ' AND text LIKE ?'; params.push(`%${filters.search}%`); }
  if (filters.excludeSeed) { sql += ` ${seedFilter('brand_mentions')}`; }

  const sortMap = { newest: 'published_at DESC', oldest: 'published_at ASC', popular: '(likes + comments) DESC', reach: 'author_reach DESC' };
  sql += ` ORDER BY ${sortMap[filters.sort || 'newest']} LIMIT 300`;

  return (db.prepare(sql).all(...params) as MentionRow[]).map(rowToMention);
}

export function getBrandMention(id: string): BrandMention | null {
  const row = getDb().prepare('SELECT * FROM brand_mentions WHERE id = ?').get(id) as MentionRow | undefined;
  return row ? rowToMention(row) : null;
}

export function patchMention(id: string, data: { sentiment?: string; emotion?: string; intent?: string }): void {
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.sentiment !== undefined) { fields.push('sentiment = ?'); params.push(data.sentiment); }
  if (data.emotion !== undefined) { fields.push('emotion = ?'); params.push(data.emotion); }
  if (data.intent !== undefined) { fields.push('intent = ?'); params.push(data.intent); }
  if (!fields.length) return;
  params.push(id);
  db.prepare(`UPDATE brand_mentions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function insertBrandMention(m: Omit<BrandMention, 'created_at'>): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO brand_mentions
      (id, brand_id, source_type, platform, author_name, author_handle, author_avatar_url, author_reach,
       text, url, likes, comments, sentiment, emotion, intent, is_crisis, is_high_impact, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    m.id, m.brand_id, m.source_type, m.platform, m.author_name, m.author_handle, m.author_avatar_url, m.author_reach,
    m.text, m.url, m.likes, m.comments, m.sentiment, m.emotion, m.intent, m.is_crisis ? 1 : 0, m.is_high_impact ? 1 : 0, m.published_at,
  );
}

// ─── Stats ──────────────────────────────────────────────
export function getBrandMentionStats(brand_id: string, filters?: { source_type?: string; excludeSeed?: boolean }): BrandMentionStats {
  const mentions = getBrandMentions({ brand_id, source_type: filters?.source_type, excludeSeed: filters?.excludeSeed, sort: 'newest' });

  const positive = mentions.filter(m => m.sentiment === 'positive').length;
  const negative = mentions.filter(m => m.sentiment === 'negative').length;
  const neutral = mentions.filter(m => m.sentiment === 'neutral' || !m.sentiment).length;
  const reach = mentions.reduce((s, m) => s + (m.author_reach || 0), 0);
  const interactions = mentions.reduce((s, m) => s + (m.likes || 0) + (m.comments || 0), 0);
  const healthScore = mentions.length ? Math.round((positive / mentions.length) * 100) : 0;

  const platformCounts = new Map<string, number>();
  const emotionCounts = new Map<string, number>();
  const intentCounts = new Map<string, number>();
  const trendMap = new Map<string, { positive: number; negative: number; neutral: number }>();

  for (const m of mentions) {
    platformCounts.set(m.platform, (platformCounts.get(m.platform) || 0) + 1);
    const emotion = m.emotion || 'neutral';
    emotionCounts.set(emotion, (emotionCounts.get(emotion) || 0) + 1);
    if (m.intent) intentCounts.set(m.intent, (intentCounts.get(m.intent) || 0) + 1);

    const date = (m.published_at || m.created_at || '').slice(0, 10);
    if (date) {
      const bucket = trendMap.get(date) || { positive: 0, negative: 0, neutral: 0 };
      if (m.sentiment === 'positive') bucket.positive++;
      else if (m.sentiment === 'negative') bucket.negative++;
      else bucket.neutral++;
      trendMap.set(date, bucket);
    }
  }

  const toSorted = (m: Map<string, number>, key: string) =>
    Array.from(m.entries()).map(([k, count]) => ({ [key]: k, count })).sort((a, b) => b.count - a.count) as never;

  return {
    mentions: mentions.length,
    reach,
    interactions,
    positive, negative, neutral,
    healthScore,
    platformBreakdown: toSorted(platformCounts, 'platform'),
    emotionBreakdown: toSorted(emotionCounts, 'emotion'),
    intentBreakdown: toSorted(intentCounts, 'intent'),
    trend: Array.from(trendMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    crisisCount: mentions.filter(m => m.is_crisis).length,
    highImpactCount: mentions.filter(m => m.is_high_impact).length,
    totalArticles: mentions.filter(m => m.source_type === 'news').length,
    topMention: mentions.slice().sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))[0] || null,
  };
}

export function getTopCreators(brand_id: string, filters?: { excludeSeed?: boolean }): BrandCreator[] {
  const mentions = getBrandMentions({ brand_id, source_type: 'social', excludeSeed: filters?.excludeSeed, sort: 'newest' });
  const byAuthor = new Map<string, BrandCreator>();
  for (const m of mentions) {
    if (!m.author_handle) continue;
    const key = `${m.platform}:${m.author_handle}`;
    const existing = byAuthor.get(key);
    if (existing) {
      existing.mentionCount++;
      existing.reach += m.author_reach || 0;
      existing.engagement += (m.likes || 0) + (m.comments || 0);
    } else {
      byAuthor.set(key, {
        author_handle: m.author_handle, author_name: m.author_name, platform: m.platform,
        mentionCount: 1, reach: m.author_reach || 0, engagement: (m.likes || 0) + (m.comments || 0),
      });
    }
  }
  return Array.from(byAuthor.values()).sort((a, b) => b.reach - a.reach).slice(0, 10);
}

// ─── Competitors ────────────────────────────────────────
export function getBrandCompetitors(brand_id: string): BrandCompetitor[] {
  return getDb().prepare('SELECT * FROM brand_competitors WHERE brand_id = ? ORDER BY created_at DESC').all(brand_id) as BrandCompetitor[];
}

export function createBrandCompetitor(brand_id: string, name: string): BrandCompetitor {
  const id = `bcomp_${crypto.randomUUID()}`;
  getDb().prepare('INSERT INTO brand_competitors (id, brand_id, name) VALUES (?, ?, ?)').run(id, brand_id, name);
  return getDb().prepare('SELECT * FROM brand_competitors WHERE id = ?').get(id) as BrandCompetitor;
}

export function deleteBrandCompetitor(id: string): void {
  getDb().prepare('DELETE FROM brand_competitors WHERE id = ?').run(id);
}

// ─── Campaigns ──────────────────────────────────────────
type CampaignRow = Omit<BrandCampaign, 'keywords'> & { keywords: string };
function rowToCampaign(row: CampaignRow): BrandCampaign {
  return { ...row, keywords: JSON.parse(row.keywords || '[]') };
}

export function getBrandCampaigns(brand_id: string): BrandCampaign[] {
  const rows = getDb().prepare('SELECT * FROM brand_campaigns WHERE brand_id = ? ORDER BY created_at DESC').all(brand_id) as CampaignRow[];
  return rows.map(rowToCampaign);
}

export function createBrandCampaign(brand_id: string, data: { name: string; keywords: string[]; starts_at?: string; ends_at?: string }): BrandCampaign {
  const id = `bcamp_${crypto.randomUUID()}`;
  getDb().prepare('INSERT INTO brand_campaigns (id, brand_id, name, keywords, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, brand_id, data.name, JSON.stringify(data.keywords), data.starts_at || null, data.ends_at || null,
  );
  return rowToCampaign(getDb().prepare('SELECT * FROM brand_campaigns WHERE id = ?').get(id) as CampaignRow);
}

export function deleteBrandCampaign(id: string): void {
  getDb().prepare('DELETE FROM brand_campaigns WHERE id = ?').run(id);
}

// ─── Alerts ─────────────────────────────────────────────
type AlertRow = Omit<BrandAlert, 'filters'> & { filters: string };
function rowToAlert(row: AlertRow): BrandAlert {
  return { ...row, filters: JSON.parse(row.filters || '{}') };
}

export function getBrandAlerts(brand_id: string): BrandAlert[] {
  const rows = getDb().prepare('SELECT * FROM brand_alerts WHERE brand_id = ? ORDER BY created_at DESC').all(brand_id) as AlertRow[];
  return rows.map(rowToAlert);
}

export function createBrandAlert(brand_id: string, data: { name: string; filters: Record<string, string> }): BrandAlert {
  const id = `balert_${crypto.randomUUID()}`;
  getDb().prepare('INSERT INTO brand_alerts (id, brand_id, name, filters) VALUES (?, ?, ?, ?)').run(
    id, brand_id, data.name, JSON.stringify(data.filters || {}),
  );
  return rowToAlert(getDb().prepare('SELECT * FROM brand_alerts WHERE id = ?').get(id) as AlertRow);
}

export function deleteBrandAlert(id: string): void {
  getDb().prepare('DELETE FROM brand_alerts WHERE id = ?').run(id);
}

/** Scans current mentions against an alert's filters and raises an in-app notification if any match arrived since last check. */
export function checkBrandAlert(id: string): { matched: number } {
  const db = getDb();
  const alert = rowToAlert(db.prepare('SELECT * FROM brand_alerts WHERE id = ?').get(id) as AlertRow);
  const since = alert.last_checked_at;

  let sql = 'SELECT * FROM brand_mentions WHERE brand_id = ?';
  const params: unknown[] = [alert.brand_id];
  if (alert.filters.sentiment) { sql += ' AND sentiment = ?'; params.push(alert.filters.sentiment); }
  if (alert.filters.platform) { sql += ' AND platform = ?'; params.push(alert.filters.platform); }
  if (alert.filters.keyword) { sql += ' AND text LIKE ?'; params.push(`%${alert.filters.keyword}%`); }
  if (since) { sql += ' AND created_at > ?'; params.push(since); }
  sql += ' ORDER BY created_at DESC LIMIT 50';

  const matches = (db.prepare(sql).all(...params) as MentionRow[]).map(rowToMention);

  db.prepare('UPDATE brand_alerts SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

  if (matches.length) {
    createNotification({
      type: 'brand_alert',
      severity: alert.filters.sentiment === 'negative' ? 'warning' : 'info',
      title: alert.name,
      message: `${matches.length} new mention${matches.length === 1 ? '' : 's'} matched "${alert.name}"`,
      data: { alert_id: id, mention_ids: matches.map(m => m.id) },
    });
  }

  return { matched: matches.length };
}

// ─── Digests ────────────────────────────────────────────
export function getBrandDigests(brand_id: string): BrandDigest[] {
  return getDb().prepare('SELECT * FROM brand_digests WHERE brand_id = ? ORDER BY created_at DESC').all(brand_id) as BrandDigest[];
}

export function getBrandDigest(id: string): BrandDigest | null {
  return (getDb().prepare('SELECT * FROM brand_digests WHERE id = ?').get(id) as BrandDigest) || null;
}

/** Builds a templated auto-summary from real aggregate stats — not AI-generated. */
export function createBrandDigest(brand_id: string, filters?: { excludeSeed?: boolean }): BrandDigest {
  const brand = getBrand(brand_id);
  const stats = getBrandMentionStats(brand_id, filters);
  const periodEnd = new Date().toISOString().slice(0, 10);
  const periodStart = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const topPlatform = stats.platformBreakdown[0];
  const sentimentLead = stats.positive >= stats.negative ? 'positive' : 'negative';
  const title = `${brand?.name || 'Brand'} mentions ${sentimentLead === 'positive' ? 'trending positive' : 'facing headwinds'}`;

  const lines = [
    `Over the past 7 days, ${brand?.name || 'the brand'} picked up ${stats.mentions} mentions across ${stats.platformBreakdown.length} platform${stats.platformBreakdown.length === 1 ? '' : 's'}, reaching an estimated ${stats.reach.toLocaleString()} people with ${stats.interactions.toLocaleString()} interactions.`,
    `Sentiment split: ${stats.positive} positive, ${stats.negative} negative, ${stats.neutral} neutral (health score ${stats.healthScore}/100).`,
    topPlatform ? `${topPlatform.platform} was the most active source with ${topPlatform.count} mention${topPlatform.count === 1 ? '' : 's'}.` : '',
    stats.crisisCount > 0 ? `${stats.crisisCount} mention${stats.crisisCount === 1 ? '' : 's'} flagged as crisis-relevant — worth a manual review.` : 'No crisis-flagged mentions this period.',
    stats.topMention ? `Top mention by engagement: "${stats.topMention.text.slice(0, 140)}${stats.topMention.text.length > 140 ? '…' : ''}"` : '',
  ].filter(Boolean);

  const id = `bdig_${crypto.randomUUID()}`;
  const body = lines.join('\n\n');
  getDb().prepare('INSERT INTO brand_digests (id, brand_id, title, body, period_start, period_end) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, brand_id, title, body, periodStart, periodEnd,
  );
  return { id, brand_id, title, body, period_start: periodStart, period_end: periodEnd, created_at: new Date().toISOString() };
}
