/**
 * Seed script that populates the Marketing Dashboard SQLite database with sample data.
 * Run with: npx tsx scripts/seed.ts
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.HERMES_DB_PATH || path.join(process.cwd(), 'hermes.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Helpers ──────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function dateStr(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Ensure tables exist (same migration as db.ts) ────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS content_posts (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, format TEXT NOT NULL,
    pillar INTEGER, text_preview TEXT, full_content TEXT,
    status TEXT NOT NULL DEFAULT 'draft', scheduled_for DATETIME,
    published_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    impressions INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0, reposts INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0, engagement_rate REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, title TEXT,
    company TEXT, company_size TEXT, industry_segment TEXT, source TEXT,
    email TEXT, linkedin_url TEXT, status TEXT NOT NULL DEFAULT 'new',
    score INTEGER, tier TEXT, last_touch_at DATETIME,
    next_action_at DATETIME, sequence_name TEXT, reply_type TEXT,
    notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id),
    sequence_name TEXT, step INTEGER, subject TEXT, body TEXT,
    status TEXT, tier TEXT, scheduled_for DATETIME, sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS suppression (
    email TEXT PRIMARY KEY, type TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT,
    action_type TEXT, target_url TEXT, target_username TEXT,
    our_text TEXT, status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, type TEXT,
    username TEXT, tweet_url TEXT, summary TEXT, relevance TEXT,
    action_taken TEXT, likes INTEGER, impressions INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, week INTEGER,
    hypothesis TEXT, action TEXT, metric TEXT, win_threshold TEXT,
    status TEXT, results TEXT, winner TEXT, margin TEXT,
    decision TEXT, learning TEXT, next_action TEXT,
    proposed_at DATETIME, completed_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, learning TEXT,
    validated_week INTEGER, confidence TEXT, applied_to TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS daily_metrics (
    date TEXT PRIMARY KEY, x_posts INTEGER DEFAULT 0,
    x_threads INTEGER DEFAULT 0, linkedin_drafts INTEGER DEFAULT 0,
    x_replies INTEGER DEFAULT 0, x_quote_tweets INTEGER DEFAULT 0,
    x_follows INTEGER DEFAULT 0, linkedin_comments INTEGER DEFAULT 0,
    discoveries INTEGER DEFAULT 0, enrichments INTEGER DEFAULT 0,
    sends INTEGER DEFAULT 0, replies_triaged INTEGER DEFAULT 0,
    opt_outs INTEGER DEFAULT 0, bounces INTEGER DEFAULT 0,
    total_impressions INTEGER DEFAULT 0, total_engagement INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts DATETIME,
    action TEXT, detail TEXT, result TEXT
  );
`);

// ── Seed registry table ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS seed_registry (
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    PRIMARY KEY (table_name, record_id)
  );
`);

// ── Brand mentions tables (same shape as db.ts migrate()) ────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS brand_mentions (
    id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
    source_type TEXT NOT NULL, platform TEXT NOT NULL,
    author_name TEXT, author_handle TEXT, author_avatar_url TEXT, author_reach INTEGER DEFAULT 0,
    text TEXT NOT NULL, url TEXT, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0,
    sentiment TEXT, emotion TEXT, intent TEXT,
    is_crisis INTEGER DEFAULT 0, is_high_impact INTEGER DEFAULT 0,
    published_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS brand_competitors (
    id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
    name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS brand_campaigns (
    id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
    name TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]',
    starts_at DATETIME, ends_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS brand_alerts (
    id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
    name TEXT NOT NULL, filters TEXT NOT NULL DEFAULT '{}',
    last_checked_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS brand_digests (
    id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
    title TEXT, body TEXT, period_start TEXT, period_end TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Wipe existing seed data ──────────────────────────────────────────

const tables = [
  'activity_log', 'daily_metrics', 'learnings', 'experiments',
  'signals', 'engagements', 'suppression', 'sequences', 'leads', 'content_posts',
  'brand_mentions', 'brand_competitors', 'brand_campaigns', 'brand_alerts', 'brand_digests', 'brands',
];
for (const t of tables) db.exec(`DELETE FROM ${t}`);
db.exec('DELETE FROM seed_registry');

console.log('Cleared existing data.\n');

const registerSeed = db.prepare('INSERT OR IGNORE INTO seed_registry (table_name, record_id) VALUES (?, ?)');

// ── 1. Content Posts (20 items) ──────────────────────────────────────

const contentInsert = db.prepare(`
  INSERT INTO content_posts (id, platform, format, pillar, text_preview, status,
    scheduled_for, published_at, created_at, impressions, likes, replies, reposts, saves, engagement_rate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const posts = [
  { platform: 'x', format: 'short_post', pillar: 1, text: 'Most AI agents fail because they try to do everything. Hermes does one thing: turns your expertise into pipeline. Here\'s how 👇', status: 'published', daysBack: 0, imp: 4200, likes: 89, replies: 23, reposts: 31, saves: 15 },
  { platform: 'x', format: 'thread', pillar: 2, text: 'Thread: We analyzed 500 SaaS cold emails. 3 patterns that actually get replies (and 4 that guarantee spam folder) 🧵', status: 'published', daysBack: 1, imp: 8900, likes: 210, replies: 67, reposts: 94, saves: 45 },
  { platform: 'x', format: 'short_post', pillar: 3, text: 'Stop sending "just checking in" follow-ups. Here\'s what to send instead based on 10k data points...', status: 'published', daysBack: 2, imp: 3100, likes: 65, replies: 18, reposts: 22, saves: 11 },
  { platform: 'x', format: 'short_post', pillar: 1, text: 'Your outbound is broken because you\'re optimizing for volume instead of relevance. The math doesn\'t work anymore.', status: 'published', daysBack: 3, imp: 2400, likes: 42, replies: 9, reposts: 14, saves: 7 },
  { platform: 'x', format: 'thread', pillar: 4, text: 'We just shipped experiment tracking in our marketing engine. Why we think A/B testing your outreach is non-negotiable 🧵', status: 'published', daysBack: 4, imp: 5600, likes: 124, replies: 38, reposts: 52, saves: 28 },
  { platform: 'x', format: 'short_post', pillar: 5, text: 'Hermes update: Our AI agent now handles X engagement, content creation, and cold outreach autonomously. Building in public.', status: 'published', daysBack: 5, imp: 6800, likes: 156, replies: 44, reposts: 63, saves: 32 },
  { platform: 'x', format: 'short_post', pillar: 2, text: 'The best cold emails don\'t sell. They start conversations. Here\'s the framework we use for Tier A prospects...', status: 'published', daysBack: 6, imp: 3800, likes: 78, replies: 21, reposts: 28, saves: 18 },
  { platform: 'x', format: 'short_post', pillar: 3, text: 'Automated follow-up sequences that feel human? Possible, but only if you personalize at the signal level.', status: 'published', daysBack: 7, imp: 2100, likes: 35, replies: 8, reposts: 12, saves: 5 },
  { platform: 'linkedin', format: 'text_post', pillar: 1, text: 'We replaced our entire outbound stack with an AI agent. 3 weeks in, here are the numbers...', status: 'published', daysBack: 3, imp: 1200, likes: 34, replies: 12, reposts: 8, saves: 6 },
  { platform: 'linkedin', format: 'text_post', pillar: 5, text: 'Building an AI marketing engine for dev tool companies. Week 2 update and key learnings.', status: 'published', daysBack: 7, imp: 890, likes: 22, replies: 7, reposts: 4, saves: 3 },
  // Pending and draft
  { platform: 'x', format: 'short_post', pillar: 1, text: 'Draft: Why we think AI agents should own the full funnel, not just one step...', status: 'pending_approval', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'thread', pillar: 2, text: 'Draft thread: 5 cold email subject lines we tested this week and the winner surprised us', status: 'pending_approval', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'short_post', pillar: 4, text: 'Draft: This week\'s experiment — emoji in subject lines vs no emoji. Hypothesis: emoji increases open rate by 15%', status: 'pending_approval', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'linkedin', format: 'text_post', pillar: 3, text: 'Draft: The 3-touch framework for dev tool outreach that gets 22% reply rates', status: 'pending_approval', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'short_post', pillar: 1, text: 'Scheduled: Your tech stack is not your moat. Your go-to-market engine is.', status: 'ready', daysBack: -1, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'short_post', pillar: 2, text: 'Scheduled: Cold email is dead? We sent 200 last week and booked 8 calls. Here\'s our approach.', status: 'ready', daysBack: -2, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'short_post', pillar: 5, text: 'Early draft: Building in public means sharing failures too. Here\'s what didn\'t work this week.', status: 'draft', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'thread', pillar: 3, text: 'Early draft: Thread on multi-touch sequences — timing, channel mix, and escalation patterns', status: 'draft', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'linkedin', format: 'carousel', pillar: 4, text: 'Early draft: Carousel — 5 experiments every dev tool should run in their first 90 days', status: 'draft', daysBack: 0, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
  { platform: 'x', format: 'short_post', pillar: 1, text: 'Rejected: "AI will replace all marketers" — too clickbaity, doesn\'t match our tone', status: 'rejected', daysBack: 1, imp: 0, likes: 0, replies: 0, reposts: 0, saves: 0 },
];

const insertPosts = db.transaction(() => {
  for (const p of posts) {
    const total = p.likes + p.replies + p.reposts + p.saves;
    const er = p.imp > 0 ? total / p.imp : 0;
    contentInsert.run(
      `cp-${uid()}`, p.platform, p.format, p.pillar, p.text, p.status,
      p.daysBack <= 0 ? daysAgo(Math.abs(p.daysBack)) : null,
      p.status === 'published' ? daysAgo(p.daysBack) : null,
      daysAgo(Math.max(p.daysBack, 0)),
      p.imp, p.likes, p.replies, p.reposts, p.saves, Math.round(er * 10000) / 10000,
    );
  }
});
insertPosts();
// Register all seeded content posts
for (const row of db.prepare('SELECT id FROM content_posts').all() as { id: string }[]) {
  registerSeed.run('content_posts', row.id);
}
console.log(`✓ Inserted ${posts.length} content posts`);

// ── 2. Leads (18) ───────────────────────────────────────────────────

const leadInsert = db.prepare(`
  INSERT INTO leads (id, first_name, last_name, title, company, company_size,
    industry_segment, source, email, linkedin_url, status, score, tier,
    last_touch_at, next_action_at, sequence_name, reply_type, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const leadsData = [
  { fn: 'Sarah', ln: 'Chen', title: 'VP Engineering', co: 'StreamScale', sz: '51-200', seg: 'data_infra', src: 'x_research', status: 'booked', score: 92, tier: 'A', seq: 'tier-a-data-infra', reply: 'interested', note: 'Asked about API integrations, demo Thursday' },
  { fn: 'Marcus', ln: 'Rivera', title: 'CTO', co: 'DevFlow', sz: '11-50', seg: 'devtools', src: 'x_research', status: 'interested', score: 87, tier: 'A', seq: 'tier-a-devtools', reply: 'interested', note: 'Replied positively to thread about agent architecture' },
  { fn: 'Priya', ln: 'Patel', title: 'Head of Growth', co: 'CloudNine AI', sz: '51-200', seg: 'ai_ml', src: 'listening', status: 'replied', score: 78, tier: 'A', seq: 'tier-a-ai-ml', reply: 'positive', note: 'Mentioned looking for outbound automation' },
  { fn: 'James', ln: 'O\'Brien', title: 'Director of Sales', co: 'CodeShip', sz: '201-500', seg: 'devtools', src: 'cold_outreach', status: 'contacted', score: 72, tier: 'A', seq: 'tier-a-devtools', reply: null, note: 'Step 1 sent, opened 3x' },
  { fn: 'Lisa', ln: 'Wang', title: 'Founder', co: 'Nexus Labs', sz: '1-10', seg: 'ai_ml', src: 'x_research', status: 'qualified', score: 95, tier: 'A', seq: null, reply: 'interested', note: 'Converted from X DM, wants enterprise plan' },
  { fn: 'David', ln: 'Kim', title: 'Growth Lead', co: 'ByteBridge', sz: '11-50', seg: 'data_infra', src: 'listening', status: 'contacted', score: 65, tier: 'B', seq: 'tier-b-generic', reply: null, note: 'Step 2 sent' },
  { fn: 'Emma', ln: 'Johnson', title: 'Marketing Director', co: 'APIFirst', sz: '51-200', seg: 'devtools', src: 'cold_outreach', status: 'new', score: 60, tier: 'B', seq: null, reply: null, note: 'Identified from hiring signal' },
  { fn: 'Alex', ln: 'Thompson', title: 'VP Product', co: 'InfraStack', sz: '201-500', seg: 'data_infra', src: 'x_research', status: 'validated', score: 68, tier: 'B', seq: null, reply: null, note: 'Email validated, queued for outreach' },
  { fn: 'Mia', ln: 'Garcia', title: 'Head of DevRel', co: 'Quantum API', sz: '51-200', seg: 'devtools', src: 'cold_outreach', status: 'replied', score: 55, tier: 'B', seq: 'tier-b-generic', reply: 'not_now', note: 'Said "not right now, circle back Q2"' },
  { fn: 'Ryan', ln: 'Zhang', title: 'Engineering Manager', co: 'DataPulse', sz: '11-50', seg: 'data_infra', src: 'listening', status: 'new', score: 50, tier: 'B', seq: null, reply: null, note: 'Tweeted about outreach pain points' },
  { fn: 'Olivia', ln: 'Brown', title: 'Founder', co: 'MLOps.io', sz: '1-10', seg: 'ai_ml', src: 'x_research', status: 'contacted', score: 58, tier: 'B', seq: 'tier-b-generic', reply: null, note: 'Step 1 sent yesterday' },
  { fn: 'Noah', ln: 'Williams', title: 'CTO', co: 'PipelineHQ', sz: '11-50', seg: 'devtools', src: 'cold_outreach', status: 'validated', score: 45, tier: 'C', seq: null, reply: null, note: 'Lower priority — small team' },
  { fn: 'Sophia', ln: 'Lee', title: 'Growth Manager', co: 'ScaleKit', sz: '51-200', seg: 'data_infra', src: 'cold_outreach', status: 'new', score: 42, tier: 'C', seq: null, reply: null, note: 'Batch enrichment pending' },
  { fn: 'Ethan', ln: 'Davis', title: 'VP Sales', co: 'DeployBot', sz: '201-500', seg: 'devtools', src: 'listening', status: 'contacted', score: 38, tier: 'C', seq: 'tier-c-batch', reply: null, note: 'Step 1, no open yet' },
  { fn: 'Ava', ln: 'Martinez', title: 'Head of Marketing', co: 'NeuralStack', sz: '51-200', seg: 'ai_ml', src: 'cold_outreach', status: 'opted_out', score: 30, tier: 'C', seq: null, reply: 'opt_out', note: 'Unsubscribed after step 1' },
  { fn: 'Liam', ln: 'Anderson', title: 'CEO', co: 'TinyOps', sz: '1-10', seg: 'devtools', src: 'x_research', status: 'bounced', score: 0, tier: 'C', seq: null, reply: 'bounce', note: 'Email bounced — domain expired' },
  { fn: 'Isabella', ln: 'Taylor', title: 'Engineering Lead', co: 'GraphBase', sz: '11-50', seg: 'data_infra', src: 'cold_outreach', status: 'interested', score: 80, tier: 'A', seq: 'tier-a-data-infra', reply: 'interested', note: 'Wants to see case studies' },
  { fn: 'Mason', ln: 'Hernandez', title: 'Product Lead', co: 'AgentForge', sz: '11-50', seg: 'ai_ml', src: 'listening', status: 'replied', score: 70, tier: 'A', seq: 'tier-a-ai-ml', reply: 'positive', note: 'Asked about pricing, sent info' },
];

const insertLeads = db.transaction(() => {
  for (let i = 0; i < leadsData.length; i++) {
    const l = leadsData[i];
    const id = `lead-${uid()}`;
    const emailDomain = 'example.test';
    leadInsert.run(
      id, l.fn, l.ln, l.title, l.co, l.sz, l.seg, l.src,
      `${l.fn.toLowerCase()}.${l.ln.toLowerCase()}@${emailDomain}`,
      `https://linkedin.com/in/${l.fn.toLowerCase()}${l.ln.toLowerCase()}`,
      l.status, l.score, l.tier,
      daysAgo(Math.floor(Math.random() * 7)),
      l.status === 'booked' ? daysAgo(-2) : null,
      l.seq, l.reply, l.note, daysAgo(14 - i),
    );
  }
});
insertLeads();
for (const row of db.prepare('SELECT id FROM leads').all() as { id: string }[]) {
  registerSeed.run('leads', row.id);
}
console.log(`✓ Inserted ${leadsData.length} leads`);

// ── 3. Sequences ─────────────────────────────────────────────────────

const seqInsert = db.prepare(`
  INSERT INTO sequences (id, lead_id, sequence_name, step, subject, body, status, tier, scheduled_for, sent_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Get lead IDs from DB
const leadRows = db.prepare('SELECT id, tier, sequence_name, first_name, company FROM leads WHERE sequence_name IS NOT NULL').all() as Array<{id: string; tier: string; sequence_name: string; first_name: string; company: string}>;

const insertSeqs = db.transaction(() => {
  for (const lead of leadRows) {
    const steps = lead.tier === 'A' ? 3 : lead.tier === 'B' ? 2 : 1;
    for (let step = 1; step <= steps; step++) {
      const subjects = [
        `Quick question about ${lead.company}'s growth strategy`,
        `Following up — thought you'd find this relevant`,
        `Last note — ${lead.first_name}, one more idea for ${lead.company}`,
      ];
      const bodies = [
        `Hi ${lead.first_name},\n\nI noticed ${lead.company} is scaling its dev team. We help companies like yours automate outbound and turn expertise into pipeline.\n\nWould a 15-min walkthrough be useful?\n\nBest,\nNyk`,
        `Hi ${lead.first_name},\n\nFollowing up on my last note. We just published a case study on how a similar company in your space 3x'd their qualified pipeline.\n\nHappy to share if you're interested.\n\nBest,\nNyk`,
        `Hi ${lead.first_name},\n\nLast note from me — we're opening 5 pilot spots for our AI marketing engine this quarter. Given ${lead.company}'s trajectory, thought it might be a fit.\n\nNo worries either way.\n\nBest,\nNyk`,
      ];
      const stepStatus = step === 1 ? 'sent' : step === 2 && lead.tier === 'A' ? 'sent' : 'pending_approval';
      seqInsert.run(
        `seq-${uid()}`, lead.id, lead.sequence_name, step,
        subjects[step - 1], bodies[step - 1], stepStatus, lead.tier,
        daysAgo(7 - step * 2), stepStatus === 'sent' ? daysAgo(7 - step * 2) : null,
        daysAgo(10),
      );
    }
  }
});
insertSeqs();
for (const row of db.prepare('SELECT id FROM sequences').all() as { id: string }[]) {
  registerSeed.run('sequences', row.id);
}
const seqCount = db.prepare('SELECT COUNT(*) as c FROM sequences').get() as {c: number};
console.log(`✓ Inserted ${seqCount.c} sequence steps`);

// ── 4. Suppression ───────────────────────────────────────────────────

const supInsert = db.prepare('INSERT INTO suppression (email, type, added_at) VALUES (?, ?, ?)');
const suppressions = [
  { email: 'spam-trap@example.com', type: 'domain_block' },
  { email: 'optout@example.test', type: 'opt_out' },
  { email: 'bounce@example.test', type: 'bounce' },
  { email: 'blocklist@example.test', type: 'domain_block' },
  { email: 'old-contact@example.test', type: 'bounce' },
];
const insertSup = db.transaction(() => {
  for (const s of suppressions) supInsert.run(s.email, s.type, daysAgo(Math.floor(Math.random() * 14)));
});
insertSup();
for (const s of suppressions) registerSeed.run('suppression', s.email);
console.log(`✓ Inserted ${suppressions.length} suppression entries`);

// ── 5. Engagements (35) ─────────────────────────────────────────────

const engInsert = db.prepare(`
  INSERT INTO engagements (platform, action_type, target_url, target_username, our_text, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const xUsernames = ['@sarahdev', '@marcusbuilds', '@devtools_daily', '@ai_frontier', '@scalingops', '@indiemaker42', '@cloudguru', '@startupCTO', '@growtheng', '@mlops_weekly'];
const engagementTexts = [
  'Great point about agent reliability. We\'ve been solving this with a feedback loop approach — happy to share our architecture.',
  'This is exactly the pattern we use for cold outreach. The key insight is signal-based personalization.',
  'Interesting take! We found the opposite — higher reply rates when you lead with the problem, not the solution.',
  'Couldn\'t agree more. We just published a thread on this exact topic if you\'re interested.',
  'We had the same challenge scaling our GTM. Ended up building an AI engine for it — game changer.',
  'Love this breakdown. The data on follow-up timing matches what we\'ve seen across 500+ sequences.',
  'Hot take but I think you\'re right. Manual outreach doesn\'t scale, but automated outreach without personalization is worse.',
  'This is underrated advice. The "just checking in" follow-up is the #1 pipeline killer.',
];

const insertEng = db.transaction(() => {
  // 28 X engagements
  for (let i = 0; i < 28; i++) {
    const actionType = i < 18 ? 'reply' : i < 24 ? 'quote_tweet' : 'follow';
    const username = xUsernames[i % xUsernames.length];
    engInsert.run(
      'x', actionType,
      `https://x.com/${username.slice(1)}/status/${1800000000000 + i}`,
      username,
      actionType === 'follow' ? null : engagementTexts[i % engagementTexts.length],
      'sent',
      daysAgo(Math.floor(i / 4)),
    );
  }
  // 7 LinkedIn engagements
  for (let i = 0; i < 7; i++) {
    engInsert.run(
      'linkedin', 'comment',
      `https://linkedin.com/posts/activity-${7000000000 + i}`,
      leadsData[i].fn + ' ' + leadsData[i].ln,
      `Great insight, ${leadsData[i].fn}! We\'ve seen similar patterns in our outreach data. The key is matching the message to the buying stage.`,
      i < 4 ? 'sent' : 'draft',
      daysAgo(Math.floor(i / 2)),
    );
  }
});
insertEng();
for (const row of db.prepare('SELECT id FROM engagements').all() as { id: number }[]) {
  registerSeed.run('engagements', String(row.id));
}
console.log('✓ Inserted 35 engagements');

// ── 6. Signals (22) ─────────────────────────────────────────────────

const sigInsert = db.prepare(`
  INSERT INTO signals (date, type, username, tweet_url, summary, relevance, action_taken, likes, impressions, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const signalData = [
  { type: 'pain', user: '@sarahdev', summary: 'Frustrated with manual outbound — "spending 4h/day on email personalization"', rel: 'high', action: 'Replied with empathy + offered case study', days: 0 },
  { type: 'pain', user: '@startupCTO', summary: 'Complaining about low cold email reply rates despite high open rates', rel: 'high', action: 'Quote tweeted with our data on subject vs body optimization', days: 0 },
  { type: 'hiring', user: '@devflow_team', summary: 'Hiring first SDR — signal they\'re building outbound from scratch', rel: 'high', action: 'Added to lead pipeline as Tier A prospect', days: 1 },
  { type: 'hiring', user: '@cloudnine_ai', summary: 'Looking for growth marketer with "AI-native GTM experience"', rel: 'medium', action: 'Noted for follow-up', days: 1 },
  { type: 'launch', user: '@nexuslabs', summary: 'Just raised Series A — expanding go-to-market team', rel: 'high', action: 'DM\'d founder with congratulations + soft pitch', days: 2 },
  { type: 'launch', user: '@graphbase_io', summary: 'Launched new GraphQL API product, need to drive adoption', rel: 'high', action: 'Added to pipeline, preparing personalized sequence', days: 2 },
  { type: 'competitor', user: '@ai_frontier', summary: 'Comparing AI outbound tools — mentioned Apollo, Instantly, and "looking for better options"', rel: 'high', action: 'Replied with our differentiation (agent vs tool)', days: 0 },
  { type: 'competitor', user: '@growtheng', summary: 'Thread: "Why I stopped using Instantly for cold email" — reliability issues', rel: 'medium', action: 'Bookmarked for content inspiration', days: 3 },
  { type: 'brand_mention', user: '@indiemaker42', summary: 'Mentioned Hermes in a thread about AI-native marketing tools', rel: 'high', action: 'Thanked and engaged in thread', days: 1 },
  { type: 'brand_mention', user: '@scalingops', summary: 'Quoted our thread on cold email frameworks — "best breakdown I\'ve seen"', rel: 'high', action: 'Replied with thanks + follow', days: 3 },
  { type: 'opportunity', user: '@devtools_daily', summary: 'Newsletter asking for guest contributors on AI in GTM topic', rel: 'high', action: 'Submitted pitch for guest post', days: 2 },
  { type: 'opportunity', user: '@mlops_weekly', summary: 'Hosting Twitter Space on "AI agents in production" — open for speakers', rel: 'medium', action: 'Applied to speak', days: 4 },
  { type: 'pain', user: '@cloudguru', summary: '"Our SDR team costs $200k/year and books 5 meetings/week. There has to be a better way."', rel: 'high', action: 'Replied with ROI comparison', days: 1 },
  { type: 'pain', user: '@techfounder99', summary: 'Asking for recs on outbound tools that actually personalize beyond {first_name}', rel: 'high', action: 'Replied with our signal-based approach', days: 0 },
  { type: 'hiring', user: '@bytebridgeio', summary: 'Posting for "Head of Revenue" — scaling from PLG to sales-led', rel: 'medium', action: 'Added to pipeline', days: 5 },
  { type: 'launch', user: '@agentforge_ai', summary: 'Shipped new agent framework, wants to reach DevTools audience', rel: 'medium', action: 'Noted as potential partner/content collab', days: 4 },
  { type: 'competitor', user: '@saasfounder', summary: 'Thread comparing Lemlist vs Woodpecker vs "AI-first alternatives"', rel: 'medium', action: 'Monitoring thread for opportunities to comment', days: 2 },
  { type: 'opportunity', user: '@producthunt', summary: 'AI tools collection trending — good timing for our PH launch', rel: 'medium', action: 'Noted for launch planning', days: 3 },
  { type: 'brand_mention', user: '@marcusbuilds', summary: 'Shared our "stop sending just checking in" post — 50+ likes on their quote tweet', rel: 'high', action: 'Engaged with all commenters', days: 2 },
  { type: 'pain', user: '@scalekit_dev', summary: '"Every outbound tool promises AI personalization but it\'s just template vars"', rel: 'high', action: 'Replied explaining our context-window approach', days: 1 },
  { type: 'opportunity', user: '@devrel_conf', summary: 'CFP open for DevRelCon — "AI in Developer Marketing" track', rel: 'low', action: 'Bookmarked, will submit if bandwidth allows', days: 6 },
  { type: 'hiring', user: '@datapulse_io', summary: 'Hiring first marketing hire — "need someone who understands developers"', rel: 'medium', action: 'Queued for outreach', days: 3 },
];

const insertSig = db.transaction(() => {
  for (const s of signalData) {
    sigInsert.run(
      dateStr(s.days), s.type, s.user,
      `https://x.com/${s.user.slice(1)}/status/${1800000000000 + Math.floor(Math.random() * 999)}`,
      s.summary, s.rel, s.action,
      Math.floor(Math.random() * 200), Math.floor(Math.random() * 5000),
      daysAgo(s.days),
    );
  }
});
insertSig();
for (const row of db.prepare('SELECT id FROM signals').all() as { id: number }[]) {
  registerSeed.run('signals', String(row.id));
}
console.log(`✓ Inserted ${signalData.length} signals`);

// ── 7. Experiments (4) ──────────────────────────────────────────────

const expInsert = db.prepare(`
  INSERT INTO experiments (week, hypothesis, action, metric, win_threshold, status, results, winner, margin, decision, learning, next_action, proposed_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const experiments = [
  {
    week: 1, hypothesis: 'Question-based subject lines get higher open rates than statement-based',
    action: 'A/B test 50 emails each: questions vs statements', metric: 'open_rate',
    threshold: '+10% open rate', status: 'completed',
    results: JSON.stringify({ variant_a: { opens: 34, sent: 50, rate: 0.68 }, variant_b: { opens: 22, sent: 50, rate: 0.44 } }),
    winner: 'Question subjects', margin: '+24% open rate', decision: 'SCALE',
    learning: 'Questions in subject lines consistently outperform statements for dev audience',
    next: 'Apply to all new sequences', daysProposed: 21, daysCompleted: 14,
  },
  {
    week: 2, hypothesis: 'Engaging with prospect\'s tweets before emailing increases reply rate',
    action: 'Group A: engage 3x on X then email. Group B: email cold', metric: 'reply_rate',
    threshold: '+15% reply rate', status: 'completed',
    results: JSON.stringify({ variant_a: { replies: 8, sent: 25, rate: 0.32 }, variant_b: { replies: 3, sent: 25, rate: 0.12 } }),
    winner: 'Pre-engagement', margin: '+20% reply rate', decision: 'SCALE',
    learning: 'Pre-engagement on X builds familiarity and dramatically lifts cold email reply rates',
    next: 'Make pre-engagement standard for Tier A/B prospects', daysProposed: 14, daysCompleted: 7,
  },
  {
    week: 3, hypothesis: 'Posting threads gets 3x more engagement than single posts',
    action: 'Alternate between threads (3/week) and single posts (3/week)', metric: 'engagement_rate',
    threshold: '3x engagement', status: 'running',
    results: null, winner: null, margin: null, decision: null,
    learning: null, next: null, daysProposed: 7, daysCompleted: null,
  },
  {
    week: 4, hypothesis: 'Sending follow-ups on Tuesday morning gets better response than Thursday afternoon',
    action: 'Split next 40 follow-ups: 20 Tue 9am, 20 Thu 3pm', metric: 'reply_rate',
    threshold: '+10% reply rate', status: 'proposed',
    results: null, winner: null, margin: null, decision: null,
    learning: null, next: null, daysProposed: 0, daysCompleted: null,
  },
];

const insertExp = db.transaction(() => {
  for (const e of experiments) {
    expInsert.run(
      e.week, e.hypothesis, e.action, e.metric, e.threshold, e.status,
      e.results, e.winner, e.margin, e.decision, e.learning, e.next,
      daysAgo(e.daysProposed), e.daysCompleted != null ? daysAgo(e.daysCompleted) : null,
    );
  }
});
insertExp();
for (const row of db.prepare('SELECT id FROM experiments').all() as { id: number }[]) {
  registerSeed.run('experiments', String(row.id));
}
console.log(`✓ Inserted ${experiments.length} experiments`);

// ── 8. Learnings (5) ────────────────────────────────────────────────

const learnInsert = db.prepare(`
  INSERT INTO learnings (learning, validated_week, confidence, applied_to, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const learningsData = [
  { text: 'Question-based subject lines outperform statements by 24% open rate for developer audience', week: 1, conf: 'high', applied: JSON.stringify(['cold-outreach', 'reply-triage']) },
  { text: 'Pre-engaging on X (3+ interactions) before cold email lifts reply rate by 20%', week: 2, conf: 'high', applied: JSON.stringify(['cold-outreach', 'social-engagement']) },
  { text: 'Dev audience responds best to "show, don\'t tell" — include specific numbers and data points', week: 1, conf: 'medium', applied: JSON.stringify(['content-engine', 'cold-outreach']) },
  { text: 'Best posting times for X dev audience: 9-10 AM EST Tuesday-Thursday', week: 2, conf: 'medium', applied: JSON.stringify(['content-engine']) },
  { text: 'LinkedIn comments should be 2-3 sentences max — longer comments get less engagement', week: 3, conf: 'low', applied: JSON.stringify(['social-engagement']) },
];

const insertLearn = db.transaction(() => {
  for (const l of learningsData) learnInsert.run(l.text, l.week, l.conf, l.applied, daysAgo(l.week * 7));
});
insertLearn();
for (const row of db.prepare('SELECT id FROM learnings').all() as { id: number }[]) {
  registerSeed.run('learnings', String(row.id));
}
console.log(`✓ Inserted ${learningsData.length} learnings`);

// ── 9. Daily Metrics (60 days) ──────────────────────────────────────

const metInsert = db.prepare(`
  INSERT INTO daily_metrics (date, x_posts, x_threads, linkedin_drafts, x_replies, x_quote_tweets,
    x_follows, linkedin_comments, discoveries, enrichments, sends, replies_triaged,
    opt_outs, bounces, total_impressions, total_engagement)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMetrics = db.transaction(() => {
  for (let d = 59; d >= 0; d--) {
    const date = dateStr(d);
    const dow = new Date(date).getDay(); // 0=Sun
    const isWeekend = dow === 0 || dow === 6;
    const rampFactor = Math.min(1, (60 - d) / 30); // ramp up over 30 days
    const weekendFactor = isWeekend ? 0.3 : 1;
    const r = () => Math.max(0, Math.round((Math.random() * 0.6 + 0.7) * rampFactor * weekendFactor));

    const xPosts = Math.round(r() * 2);
    const xThreads = dow === 1 || dow === 3 ? Math.round(r()) : 0; // threads Mon/Wed
    const liDrafts = dow === 2 || dow === 4 ? Math.round(r()) : 0; // LinkedIn Tue/Thu
    const xReplies = Math.round(r() * 5);
    const xQt = Math.round(r() * 2);
    const xFollows = Math.round(r() * 3);
    const liComments = Math.round(r() * 2);
    const discoveries = Math.round(r() * 4);
    const enrichments = Math.round(r() * 2);
    const sends = isWeekend ? 0 : Math.round(r() * 3);
    const triaged = Math.round(r() * 2);
    const optOuts = Math.random() < 0.1 ? 1 : 0;
    const bounces = Math.random() < 0.05 ? 1 : 0;
    const impressions = Math.round((xPosts + xThreads * 3) * (800 + Math.random() * 2000) * rampFactor);
    const engagement = Math.round(impressions * (0.02 + Math.random() * 0.04));

    metInsert.run(
      date, xPosts, xThreads, liDrafts, xReplies, xQt, xFollows, liComments,
      discoveries, enrichments, sends, triaged, optOuts, bounces, impressions, engagement,
    );
  }
});
insertMetrics();
for (const row of db.prepare('SELECT date FROM daily_metrics').all() as { date: string }[]) {
  registerSeed.run('daily_metrics', row.date);
}
console.log('✓ Inserted 60 days of daily metrics');

// ── 10. Activity Log (recent entries) ───────────────────────────────

const actInsert = db.prepare(`
  INSERT INTO activity_log (ts, action, detail, result)
  VALUES (?, ?, ?, ?)
`);

const activityEntries = [
  // Today
  { days: 0, h: 9, action: 'research', detail: 'Morning X research scan — 6 new signals identified', result: '3 high-relevance, 2 medium, 1 low' },
  { days: 0, h: 9.5, action: 'engage', detail: 'Replied to @sarahdev about outbound automation pain point', result: 'Reply sent successfully' },
  { days: 0, h: 9.7, action: 'engage', detail: 'Quote tweeted @startupCTO on cold email reply rates', result: 'Quote tweet posted' },
  { days: 0, h: 10, action: 'post', detail: 'Published short post: "Most AI agents fail because they try to do everything"', result: '4,200 impressions, 89 likes in 2h' },
  { days: 0, h: 10.5, action: 'discover', detail: 'Enriched 3 new leads from X research signals', result: 'Sarah Chen (A), Alex Thompson (B), Ryan Zhang (B)' },
  { days: 0, h: 13, action: 'discover', detail: 'Midday listening scan — 4 new signals', result: '2 pain signals, 1 competitor mention, 1 opportunity' },
  { days: 0, h: 15, action: 'engage', detail: 'Afternoon engagement round — 5 replies, 2 quote tweets', result: 'All sent successfully' },
  // Yesterday
  { days: 1, h: 8, action: 'research', detail: 'Morning X research — 5 signals found', result: '2 high, 2 medium, 1 low' },
  { days: 1, h: 9.5, action: 'engage', detail: 'Morning engagement — 4 replies, 1 follow', result: 'All actions completed' },
  { days: 1, h: 10, action: 'post', detail: 'Published thread: "500 SaaS cold emails analyzed" (6 tweets)', result: '8,900 impressions, 210 likes — best performing thread yet' },
  { days: 1, h: 10.5, action: 'send', detail: 'Outreach pipeline: 5 emails sent (3 step 1, 2 follow-ups)', result: '3 opens so far, 1 reply (Marcus Rivera — interested)' },
  { days: 1, h: 13, action: 'discover', detail: 'Listening scan: brand mention by @indiemaker42', result: 'Engaged with mention, added to signal log' },
  { days: 1, h: 15, action: 'engage', detail: 'Afternoon engagement — 3 replies, 2 quote tweets, 2 follows', result: 'All sent' },
  { days: 1, h: 17, action: 'triage', detail: 'Reply triage: 3 new replies processed', result: '1 interested (Marcus), 1 not now (Mia), 1 question' },
  { days: 1, h: 18, action: 'research', detail: 'Daily report generated', result: 'Posts: 1, Engagement: 32 actions, Emails: 5, Pipeline: 2 interested' },
  // 2 days ago
  { days: 2, h: 8, action: 'research', detail: 'Morning X research — 4 signals', result: '1 high (launch signal), 2 medium, 1 low' },
  { days: 2, h: 10, action: 'post', detail: 'Published: "Stop sending just checking in follow-ups"', result: '3,100 impressions' },
  { days: 2, h: 10.5, action: 'send', detail: 'Outreach: 4 emails sent (2 step 1, 2 step 2)', result: '2 opens' },
  { days: 2, h: 15, action: 'engage', detail: 'Afternoon round — 6 replies, 3 follows', result: 'All actions completed' },
  { days: 2, h: 17, action: 'triage', detail: 'Reply triage: 2 replies processed', result: '1 positive (Priya Patel), 1 question' },
  // 3 days ago
  { days: 3, h: 8, action: 'research', detail: 'Morning research + competitor thread monitoring', result: '3 signals (1 competitor, 1 pain, 1 brand mention)' },
  { days: 3, h: 10, action: 'post', detail: 'Published: "Optimizing for volume vs relevance" + LinkedIn post', result: '2,400 + 1,200 impressions' },
  { days: 3, h: 10.5, action: 'send', detail: 'Outreach: 6 emails (4 step 1, 2 follow-ups)', result: '3 opens, 0 replies' },
  { days: 3, h: 11, action: 'discover', detail: 'Weekly experiment check — Experiment #2 completed', result: 'Pre-engagement WINS: +20% reply rate → SCALE' },
  // 4+ days ago (sparser)
  { days: 4, h: 10, action: 'post', detail: 'Published experiment tracking thread (6 tweets)', result: '5,600 impressions, 124 likes' },
  { days: 4, h: 10.5, action: 'send', detail: 'Outreach: 3 emails', result: '1 open' },
  { days: 5, h: 10, action: 'post', detail: 'Published Hermes update post', result: '6,800 impressions — highest single post' },
  { days: 5, h: 11, action: 'discover', detail: 'New experiment proposed: threads vs single posts', result: 'Experiment #3 status: running' },
  { days: 6, h: 10, action: 'post', detail: 'Published: "Best cold emails don\'t sell" framework post', result: '3,800 impressions' },
  { days: 7, h: 10, action: 'post', detail: 'Published: "Automated follow-up sequences" + LinkedIn update', result: '2,100 + 890 impressions' },
];

const insertAct = db.transaction(() => {
  for (const a of activityEntries) {
    const d = new Date();
    d.setDate(d.getDate() - a.days);
    d.setHours(Math.floor(a.h), Math.round((a.h % 1) * 60), 0, 0);
    actInsert.run(d.toISOString().slice(0, 19).replace('T', ' '), a.action, a.detail, a.result);
  }
});
insertAct();
for (const row of db.prepare('SELECT id FROM activity_log').all() as { id: number }[]) {
  registerSeed.run('activity_log', String(row.id));
}
console.log(`✓ Inserted ${activityEntries.length} activity log entries`);

// ── 11. Brand Mentions (Hermes) ───────────────────────────────────────
// Same UUID as DEFAULT_BRAND_ID in src/lib/brand-constants.ts.
const BRAND_ID = '97cdb115-2c90-42a8-b904-d14abce1d682';

db.prepare(`INSERT INTO brands (id, name, keywords, sources) VALUES (?, ?, ?, ?)`).run(
  BRAND_ID,
  'Hermes',
  JSON.stringify(['hermes', 'hermes ai', 'hermes dashboard', '#hermes']),
  JSON.stringify(['x', 'linkedin', 'reddit', 'threads', 'news']),
);
registerSeed.run('brands', BRAND_ID);

type MentionSeed = {
  platform: string; sourceType?: 'social' | 'news';
  author: string; handle?: string; reach: number;
  text: string; likes: number; comments: number;
  sentiment: string; emotion: string; intent: string;
  days: number; crisis?: boolean; highImpact?: boolean; url?: string;
};

const socialMentionData: MentionSeed[] = [
  { platform: 'x', author: 'Sarah Chen', handle: 'sarahbuilds', reach: 12400, text: 'Just switched our SDR workflow to Hermes and the signal-to-lead pipeline is unreal. Booked 3 calls in the first week.', likes: 89, comments: 12, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 0 },
  { platform: 'x', author: 'DevOps Marcus', handle: 'marcusbuilds', reach: 8100, text: 'Quoted a Hermes thread on cold email frameworks in our internal wiki — best breakdown I\'ve seen on signal-based outbound.', likes: 54, comments: 6, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 0 },
  { platform: 'x', author: 'GrowthOpsDaily', handle: 'growthopsdaily', reach: 22000, text: 'Comparing AI outbound tools this week: Apollo, Instantly, and Hermes. Hermes wins on signal quality but the UI still needs work.', likes: 41, comments: 19, sentiment: 'neutral', emotion: 'neutral', intent: 'other', days: 1 },
  { platform: 'x', author: 'IndieMaker42', handle: 'indiemaker42', reach: 5600, text: 'Mentioned Hermes in a thread about AI-native marketing tools — genuinely one of the few that doesn\'t feel like a wrapper.', likes: 63, comments: 8, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 1 },
  { platform: 'x', author: 'ScalingOps', handle: 'scalingops', reach: 9300, text: 'Hermes\'s pricing page confused our finance team for a solid 20 minutes. Someone please fix the tier names.', likes: 22, comments: 15, sentiment: 'negative', emotion: 'anger', intent: 'complaint', days: 2 },
  { platform: 'x', author: 'Priya Patel', handle: 'priyabuilds', reach: 3400, text: 'Anyone else notice Hermes dropped a few engagement notifications yesterday? Support said they\'re on it.', likes: 9, comments: 4, sentiment: 'negative', emotion: 'fear', intent: 'complaint', days: 2 },
  { platform: 'x', author: 'SaaS Weekly', handle: 'saasweekly', reach: 41000, text: 'Hermes just shipped agent-to-agent messaging inside their dashboard. Wild that a marketing tool ships this fast.', likes: 210, comments: 34, sentiment: 'positive', emotion: 'surprise', intent: 'news', days: 3, highImpact: true },
  { platform: 'x', author: 'techfounder99', handle: 'techfounder99', reach: 4200, text: 'Does Hermes support LinkedIn comment queues yet or is that still roadmap?', likes: 5, comments: 3, sentiment: 'neutral', emotion: 'neutral', intent: 'question', days: 4 },
  { platform: 'x', author: 'cloudguru', handle: 'cloudguru', reach: 6700, text: 'Our SDR team costs $200k/year and books 5 meetings/week. Hermes\'s signal-based approach is the first thing that\'s actually moved that number.', likes: 77, comments: 11, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 5 },
  { platform: 'x', author: 'bytebridgeio', handle: 'bytebridgeio', reach: 2900, text: 'Hermes onboarding took longer than expected but support was responsive the whole way.', likes: 14, comments: 2, sentiment: 'neutral', emotion: 'neutral', intent: 'other', days: 6 },
  { platform: 'linkedin', author: 'Dana Whitfield', reach: 18500, text: 'Six weeks into using Hermes for our outbound motion. Reply rates up 34%, and the team finally trusts the lead scoring. Worth the switch.', likes: 145, comments: 22, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 0 },
  { platform: 'linkedin', author: 'RevOps Collective', reach: 31000, text: 'Panel discussion recap: three RevOps leaders on why signal-based tools like Hermes are replacing static lead scoring models.', likes: 98, comments: 17, sentiment: 'positive', emotion: 'neutral', intent: 'news', days: 1 },
  { platform: 'linkedin', author: 'Marcus Ade', reach: 7800, text: 'Hermes\'s memory/learnings feature is underrated — it actually surfaces what worked last quarter instead of making you dig through spreadsheets.', likes: 61, comments: 5, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 2 },
  { platform: 'linkedin', author: 'Founder Weekly', reach: 26000, text: 'Hermes raised eyebrows this week after a pricing change that pushed several small teams to the next tier without notice.', likes: 33, comments: 41, sentiment: 'negative', emotion: 'anger', intent: 'complaint', days: 3, crisis: true },
  { platform: 'linkedin', author: 'Nadia Ibrahim', reach: 5200, text: 'Curious if anyone has migrated from a legacy CRM workflow to Hermes\'s pipeline view — how painful was the switch?', likes: 8, comments: 6, sentiment: 'neutral', emotion: 'neutral', intent: 'question', days: 4 },
  { platform: 'linkedin', author: 'B2B Growth Lab', reach: 14200, text: 'Hermes case study: a 4-person GTM team using agent squads to run outbound at the pace of a 15-person team.', likes: 120, comments: 9, sentiment: 'positive', emotion: 'surprise', intent: 'news', days: 5 },
  { platform: 'linkedin', author: 'Chris Okafor', reach: 3100, text: 'Small note to Hermes\'s team: the mobile nav is genuinely great. Rare to see that much polish on an internal tool.', likes: 27, comments: 1, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 6 },
  { platform: 'reddit', author: 'r/SaaS', handle: 'u/growthhacker22', reach: 116000, text: 'Has anyone actually gotten ROI from Hermes or is it another "AI marketing platform" that\'s just a fancy CRM wrapper?', likes: 34, comments: 52, sentiment: 'negative', emotion: 'anger', intent: 'complaint', days: 0 },
  { platform: 'reddit', author: 'r/startups', handle: 'u/foundermode', reach: 89000, text: 'PSA: Hermes\'s signal detection actually caught a hiring-intent post I would\'ve missed manually. Converted into a real deal within a week.', likes: 156, comments: 28, sentiment: 'positive', emotion: 'surprise', intent: 'praise', days: 1, highImpact: true },
  { platform: 'reddit', author: 'r/marketing', handle: 'u/contentqueen', reach: 45000, text: 'Why I stopped using Instantly for cold email and moved to Hermes — reliability issues on the old tool, cleaner deliverability data on the new one.', likes: 71, comments: 19, sentiment: 'positive', emotion: 'joy', intent: 'other', days: 2 },
  { platform: 'reddit', author: 'r/SaaS', handle: 'u/skepticalCTO', reach: 116000, text: 'Hermes support took 3 days to respond to a billing question. Not great for a tool at this price point.', likes: 19, comments: 14, sentiment: 'negative', emotion: 'anger', intent: 'complaint', days: 3 },
  { platform: 'reddit', author: 'r/Entrepreneur', handle: 'u/bootstrapped_bee', reach: 210000, text: 'Question for the group — is Hermes worth it for a 2-person team or is it overkill?', likes: 12, comments: 22, sentiment: 'neutral', emotion: 'neutral', intent: 'question', days: 5 },
  { platform: 'reddit', author: 'r/marketing', handle: 'u/dataisdead', reach: 45000, text: 'Ran the numbers — Hermes\'s open-source-adjacent pricing actually beats three of the "enterprise" competitors we evaluated.', likes: 88, comments: 10, sentiment: 'positive', emotion: 'surprise', intent: 'other', days: 6 },
  { platform: 'threads', author: '9to5marketing', reach: 41200, text: 'Hermes\'s new agent squads feature is the first "multi-agent" marketing pitch that actually made sense to me on first read.', likes: 33, comments: 4, sentiment: 'positive', emotion: 'joy', intent: 'news', days: 0 },
  { platform: 'threads', author: 'ops_with_opal', reach: 6300, text: 'Hermes dashboard down for like 10 minutes this morning. Back now but that\'s the second time this month.', likes: 7, comments: 9, sentiment: 'negative', emotion: 'fear', intent: 'complaint', days: 1 },
  { platform: 'threads', author: 'thefounderpod', reach: 18900, text: 'Hermes\'s founder just did an AMA on signal-based GTM. Genuinely one of the better technical explanations of "AI marketing" I\'ve heard.', likes: 102, comments: 13, sentiment: 'positive', emotion: 'surprise', intent: 'praise', days: 2 },
  { platform: 'threads', author: 'quietbuilder', reach: 2100, text: 'Anyone know if Hermes has a public API for the signals table yet?', likes: 4, comments: 2, sentiment: 'neutral', emotion: 'neutral', intent: 'question', days: 4 },
  { platform: 'facebook', author: 'Marketing Ops Group', reach: 15400, text: 'Group discussion: is Hermes\'s approval-based content queue better than a traditional editorial calendar? Split opinions here.', likes: 41, comments: 37, sentiment: 'neutral', emotion: 'neutral', intent: 'other', days: 1 },
  { platform: 'facebook', author: 'Lena Ortiz', reach: 890, text: 'Loving Hermes for keeping our small team\'s outbound organized. Wish the calendar view synced with Google Calendar though.', likes: 18, comments: 3, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 3 },
  { platform: 'facebook', author: 'Small Biz Growth Hub', reach: 22000, text: 'Warning from a member: Hermes billed an extra seat without a clear heads-up. Double check your invoice.', likes: 25, comments: 44, sentiment: 'negative', emotion: 'anger', intent: 'complaint', days: 4, crisis: true },
  { platform: 'instagram', author: 'startuplifedaily', reach: 34000, text: 'Behind the scenes: our SDR using Hermes\'s live feed to catch a brand mention in real time. Oddly satisfying to watch.', likes: 512, comments: 21, sentiment: 'positive', emotion: 'joy', intent: 'other', days: 0 },
  { platform: 'instagram', author: 'b2b.growth.tips', reach: 51000, text: 'Carousel: 5 tools we swapped this year, #3 is Hermes replacing our old spreadsheet-based lead tracker.', likes: 640, comments: 38, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 2, highImpact: true },
  { platform: 'instagram', author: 'foundermemes', reach: 88000, text: 'When the AI marketing tool actually books the meeting instead of just making a nice-looking dashboard 😅 (looking at you, Hermes)', likes: 980, comments: 56, sentiment: 'positive', emotion: 'joy', intent: 'other', days: 5, highImpact: true },
  { platform: 'tiktok', author: 'saastoolreviews', reach: 62000, text: '60 second review of Hermes for solo founders — the good, the confusing pricing, and whether it\'s worth it.', likes: 2100, comments: 89, sentiment: 'neutral', emotion: 'neutral', intent: 'other', days: 1, highImpact: true },
  { platform: 'tiktok', author: 'growthhackergirl', reach: 41000, text: 'POV: you finally automate cold outbound with Hermes and your Sunday dread disappears', likes: 3400, comments: 120, sentiment: 'positive', emotion: 'joy', intent: 'praise', days: 3, highImpact: true },
  { platform: 'tiktok', author: 'techcritiquetok', reach: 28000, text: 'Hermes\'s onboarding flow made me rage-quit twice before it clicked. Once it clicks though, it\'s genuinely good.', likes: 890, comments: 65, sentiment: 'negative', emotion: 'anger', intent: 'complaint', days: 5 },
  { platform: 'youtube', author: 'The RevOps Channel', reach: 156000, text: 'Full walkthrough: setting up Hermes\'s agent squads for a 3-person GTM team from zero.', likes: 1240, comments: 87, sentiment: 'positive', emotion: 'joy', intent: 'news', days: 2, highImpact: true },
  { platform: 'youtube', author: 'SaaS Teardown', reach: 98000, text: 'Teardown: what Hermes gets right (signal detection) and wrong (pricing clarity) in this deep dive.', likes: 670, comments: 112, sentiment: 'neutral', emotion: 'neutral', intent: 'other', days: 4, highImpact: true },
];

const newsMentionData: MentionSeed[] = [
  { platform: 'news', sourceType: 'news', author: 'TechCrunch', reach: 2100000, text: 'Hermes raises new funding to expand its "agent-native" marketing operations platform for early-stage GTM teams.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'joy', intent: 'news', days: 0, highImpact: true, url: 'https://example.com/news/hermes-funding' },
  { platform: 'news', sourceType: 'news', author: 'MarketingDive', reach: 340000, text: 'How signal-based outbound tools like Hermes are reshaping SDR hiring at early-stage startups.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'neutral', intent: 'news', days: 1, url: 'https://example.com/news/signal-based-outbound' },
  { platform: 'news', sourceType: 'news', author: 'SaaStr Daily', reach: 210000, text: 'Hermes founder on why "agent squads" beat single-agent copilots for revenue teams.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'joy', intent: 'news', days: 2, url: 'https://example.com/news/agent-squads' },
  { platform: 'news', sourceType: 'news', author: 'The Information', reach: 890000, text: 'Hermes faces scrutiny after a billing complaint thread goes viral on Reddit and Facebook groups.', likes: 0, comments: 0, sentiment: 'negative', emotion: 'anger', intent: 'news', days: 3, crisis: true, highImpact: true, url: 'https://example.com/news/billing-scrutiny' },
  { platform: 'news', sourceType: 'news', author: 'GrowthUnhinged', reach: 76000, text: 'Product review: Hermes dashboard vs three competitors for solo-founder GTM stacks.', likes: 0, comments: 0, sentiment: 'neutral', emotion: 'neutral', intent: 'other', days: 4, url: 'https://example.com/news/dashboard-comparison' },
  { platform: 'news', sourceType: 'news', author: 'VentureBeat', reach: 540000, text: 'Hermes ships agent-to-agent messaging, betting that internal comms belong inside the GTM tool, not Slack.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'surprise', intent: 'news', days: 5, highImpact: true, url: 'https://example.com/news/agent-messaging' },
  { platform: 'news', sourceType: 'news', author: 'Startup Weekly', reach: 63000, text: 'Customer spotlight: a 4-person team using Hermes to run outbound at 15-person-team pace.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'joy', intent: 'news', days: 6, url: 'https://example.com/news/customer-spotlight' },
  { platform: 'news', sourceType: 'news', author: 'B2B Rev Report', reach: 51000, text: 'Hermes\'s memory/learnings module singled out as a "quiet differentiator" in RevOps tooling roundup.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'joy', intent: 'news', days: 7, url: 'https://example.com/news/quiet-differentiator' },
  { platform: 'news', sourceType: 'news', author: 'MarTech Signal', reach: 39000, text: 'Pricing tier confusion prompts Hermes to promise a UI refresh for its billing page next quarter.', likes: 0, comments: 0, sentiment: 'negative', emotion: 'sadness', intent: 'news', days: 8, url: 'https://example.com/news/pricing-refresh' },
  { platform: 'news', sourceType: 'news', author: 'IndieHackers Digest', reach: 28000, text: 'Weekly roundup includes Hermes among tools solo founders are quietly standardizing on for outbound.', likes: 0, comments: 0, sentiment: 'positive', emotion: 'neutral', intent: 'news', days: 9, url: 'https://example.com/news/indie-roundup' },
];

const mentionInsert = db.prepare(`
  INSERT INTO brand_mentions
    (id, brand_id, source_type, platform, author_name, author_handle, author_avatar_url, author_reach,
     text, url, likes, comments, sentiment, emotion, intent, is_crisis, is_high_impact, published_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let mentionCount = 0;
for (const m of [...socialMentionData, ...newsMentionData]) {
  const id = `bm_${uid()}${uid()}`;
  const ts = daysAgo(m.days);
  mentionInsert.run(
    id, BRAND_ID, m.sourceType || 'social', m.platform,
    m.author, m.handle || null, null, m.reach,
    m.text, m.url || null, m.likes, m.comments,
    m.sentiment, m.emotion, m.intent,
    m.crisis ? 1 : 0, m.highImpact ? 1 : 0,
    ts, ts,
  );
  registerSeed.run('brand_mentions', id);
  mentionCount++;
}
console.log(`✓ Inserted ${mentionCount} brand mentions`);

// ── 12. Brand Competitors, Campaign & Alerts ──────────────────────────
const competitorInsert = db.prepare(`INSERT INTO brand_competitors (id, brand_id, name) VALUES (?, ?, ?)`);
for (const name of ['Apollo.io', 'Instantly']) {
  const id = `bcomp_${uid()}`;
  competitorInsert.run(id, BRAND_ID, name);
  registerSeed.run('brand_competitors', id);
}
console.log('✓ Inserted 2 brand competitors');

const campaignInsert = db.prepare(`INSERT INTO brand_campaigns (id, brand_id, name, keywords, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)`);
{
  const id = `bcamp_${uid()}`;
  campaignInsert.run(id, BRAND_ID, 'Launch Week Buzz', JSON.stringify(['hermes launch', 'agent squads']), dateStr(7), dateStr(-7));
  registerSeed.run('brand_campaigns', id);
}
console.log('✓ Inserted 1 brand campaign');

const alertInsert = db.prepare(`INSERT INTO brand_alerts (id, brand_id, name, filters) VALUES (?, ?, ?, ?)`);
for (const a of [
  { name: 'All Mentions', filters: {} },
  { name: 'Positive Sentiment', filters: { sentiment: 'positive' } },
  { name: 'Negative Sentiment', filters: { sentiment: 'negative' } },
]) {
  const id = `balert_${uid()}`;
  alertInsert.run(id, BRAND_ID, a.name, JSON.stringify(a.filters));
  registerSeed.run('brand_alerts', id);
}
console.log('✓ Inserted 3 brand alerts');

// ── Done ─────────────────────────────────────────────────────────────

const counts = {
  content: (db.prepare('SELECT COUNT(*) as c FROM content_posts').get() as {c: number}).c,
  leads: (db.prepare('SELECT COUNT(*) as c FROM leads').get() as {c: number}).c,
  sequences: seqCount.c,
  suppression: suppressions.length,
  engagements: (db.prepare('SELECT COUNT(*) as c FROM engagements').get() as {c: number}).c,
  signals: (db.prepare('SELECT COUNT(*) as c FROM signals').get() as {c: number}).c,
  experiments: experiments.length,
  learnings: learningsData.length,
  daily_metrics: (db.prepare('SELECT COUNT(*) as c FROM daily_metrics').get() as {c: number}).c,
  activity_log: activityEntries.length,
  brand_mentions: mentionCount,
  seed_registry: (db.prepare('SELECT COUNT(*) as c FROM seed_registry').get() as {c: number}).c,
};

console.log('\n── Summary ──────────────────────────────');
for (const [table, count] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(16)} ${count}`);
}
console.log('─────────────────────────────────────────');
console.log(`\nDatabase: ${DB_PATH}`);

db.close();
