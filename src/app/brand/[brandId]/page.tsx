'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AtSign, Megaphone, FileText, Bell,
  Users2, ThumbsUp, HeartHandshake, Smile, Frown, RefreshCw, Search,
  Plus, Trash2, Sparkles, Download, Trophy, ExternalLink, RadioTower,
} from 'lucide-react';
import { StatTile } from '@/components/brand/stat-tile';
import { BarBreakdown } from '@/components/brand/bar-breakdown';
import { TrendChart } from '@/components/ui/trend-chart';
import { MentionCard } from '@/components/brand/mention-card';
import { PlatformBadge } from '@/components/brand/platform-badge';
import { useDashboard } from '@/store';
import { formatDate, formatDateTime, formatNumber, timeAgo } from '@/lib/utils';
import type {
  Brand, BrandMention, BrandMentionStats, BrandCreator, BrandCompetitor,
  BrandCampaign, BrandAlert, BrandDigest,
} from '@/types';

type Tab = 'overview' | 'social' | 'news' | 'analytics' | 'campaigns' | 'digests' | 'alerts';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'social', label: 'Social Mentions' },
  { key: 'news', label: 'News Mentions' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'digests', label: 'Digests' },
  { key: 'alerts', label: 'Alerts' },
];

const PLATFORMS = ['x', 'facebook', 'instagram', 'linkedin', 'reddit', 'tiktok', 'threads', 'youtube'];
const SENTIMENTS = ['positive', 'negative', 'neutral'];

export default function BrandMentionsPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const realOnly = useDashboard(s => s.realOnly);
  const [tab, setTab] = useState<Tab>('overview');
  const [brand, setBrand] = useState<Brand | null>(null);

  useEffect(() => {
    fetch(`/api/brand/${brandId}`).then(r => r.json()).then(setBrand).catch(() => {});
  }, [brandId]);

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Brand Mentions{brand ? ` — ${brand.name}` : ''}</h1>
      </div>

      <div className="panel">
        <div className="panel-body !p-0">
          <div className="flex gap-0 border-b border-border flex-wrap">
            {TABS.map(t => (
              <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'overview' && <OverviewTab brandId={brandId} realOnly={realOnly} />}
      {tab === 'social' && <MentionsTab brandId={brandId} realOnly={realOnly} sourceType="social" />}
      {tab === 'news' && <MentionsTab brandId={brandId} realOnly={realOnly} sourceType="news" />}
      {tab === 'analytics' && <AnalyticsTab brandId={brandId} realOnly={realOnly} />}
      {tab === 'campaigns' && <CampaignsTab brandId={brandId} />}
      {tab === 'digests' && <DigestsTab brandId={brandId} />}
      {tab === 'alerts' && <AlertsTab brandId={brandId} />}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────
function OverviewTab({ brandId, realOnly }: { brandId: string; realOnly: boolean }) {
  const [stats, setStats] = useState<BrandMentionStats | null>(null);
  const [mentions, setMentions] = useState<BrandMention[]>([]);

  useEffect(() => {
    const real = realOnly ? '?real=true' : '';
    fetch(`/api/brand/${brandId}/stats${real}`).then(r => r.json()).then(setStats).catch(() => {});
    fetch(`/api/brand/${brandId}/mentions?sort=popular${real ? '&real=true' : ''}`).then(r => r.json()).then((d: BrandMention[]) => setMentions(d.slice(0, 6))).catch(() => {});
  }, [brandId, realOnly]);

  function onPatch(id: string, patch: Record<string, string>) {
    setMentions(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as BrandMention : m)));
    fetch(`/api/brand/${brandId}/mentions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  }

  if (!stats) return <div className="panel p-8 text-center text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Mentions" value={stats.mentions} icon={AtSign} />
        <StatTile label="Reach" value={stats.reach} icon={Users2} color="var(--info)" />
        <StatTile label="Interactions" value={stats.interactions} icon={ThumbsUp} color="var(--success)" />
        <StatTile label="Health Score" value={stats.healthScore} icon={HeartHandshake} color="var(--warning)" format={n => `${n}/100`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Sentiment Trend</h2></div>
          <div className="panel-body">
            <TrendChart
              data={stats.trend}
              xKey="date"
              lines={[
                { key: 'positive', color: 'var(--success)', label: 'Positive' },
                { key: 'negative', color: 'var(--destructive)', label: 'Negative' },
                { key: 'neutral', color: 'var(--muted-foreground)', label: 'Neutral' },
              ]}
            />
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Platform Breakdown</h2></div>
          <div className="panel-body">
            <BarBreakdown data={stats.platformBreakdown.map(p => ({ label: p.platform, count: p.count }))} />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Top Mentions</h2></div>
        <div className="panel-body space-y-3">
          {mentions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No mentions yet</p>
          ) : mentions.map(m => <MentionCard key={m.id} mention={m} onPatch={onPatch} />)}
        </div>
      </section>
    </div>
  );
}

// ─── Social / News Mentions ────────────────────────────────
function MentionsTab({ brandId, realOnly, sourceType }: { brandId: string; realOnly: boolean; sourceType: 'social' | 'news' }) {
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [sentiments, setSentiments] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ source_type: sourceType, sort });
    if (realOnly) params.set('real', 'true');
    platforms.forEach(p => params.append('platform', p));
    sentiments.forEach(s => params.append('sentiment', s));
    if (search) params.set('search', search);
    setLoading(true);
    fetch(`/api/brand/${brandId}/mentions?${params.toString()}`).then(r => r.json()).then(setMentions).finally(() => setLoading(false));
  }, [brandId, realOnly, sourceType, sort, platforms, sentiments, search]);

  function onPatch(id: string, patch: Record<string, string>) {
    setMentions(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as BrandMention : m)));
    fetch(`/api/brand/${brandId}/mentions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/brand/${brandId}/mentions/sync`, { method: 'POST' });
      const data = await res.json();
      setSyncMsg(res.ok ? `Synced ${data.synced} new mention${data.synced === 1 ? '' : 's'} from X.` : data.error);
    } catch {
      setSyncMsg('Sync failed — check server logs.');
    } finally {
      setSyncing(false);
    }
  }

  function downloadCsv() {
    window.location.href = `/api/brand/${brandId}/export?source_type=${sourceType}${realOnly ? '&real=true' : ''}`;
  }

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  }

  const topStory = sourceType === 'news' ? mentions[0] : null;

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0 space-y-3">
        <div className="panel px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">{mentions.length} mention{mentions.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            {syncMsg && <span className="text-xs text-muted-foreground max-w-xs truncate">{syncMsg}</span>}
            <button onClick={downloadCsv} className="btn btn-ghost btn-sm"><Download size={12} /> Export</button>
            {sourceType === 'social' && (
              <button onClick={syncNow} disabled={syncing} className="brand-btn-primary btn btn-sm">
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
        </div>

        {topStory && (
          <section className="panel">
            <div className="panel-header"><h2 className="section-title">Top Story</h2></div>
            <div className="panel-body space-y-2">
              <div className="text-xs text-muted-foreground">{topStory.platform} · {timeAgo(topStory.published_at || topStory.created_at)}</div>
              <p className="text-base font-medium">{topStory.text}</p>
              {topStory.url && (
                <a href={topStory.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                  Read article <ExternalLink size={12} />
                </a>
              )}
            </div>
          </section>
        )}

        {loading ? (
          <div className="panel p-8 text-center text-muted-foreground text-sm">Loading mentions…</div>
        ) : mentions.length === 0 ? (
          <div className="panel p-8 text-center text-muted-foreground text-sm">No mentions match these filters yet.</div>
        ) : (
          <div className="space-y-3">
            {mentions.map(m => <MentionCard key={m.id} mention={m} onPatch={onPatch} />)}
          </div>
        )}
      </div>

      <aside className="w-64 shrink-0 space-y-3">
        <div className="panel p-3 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" className="w-full pl-8" />
          </div>
        </div>

        <div className="panel p-3 space-y-1.5">
          <div className="section-title mb-1">Sort by</div>
          {[{ key: 'newest', label: 'Newest first' }, { key: 'popular', label: 'Popularity' }, { key: 'reach', label: 'Reach' }].map(s => (
            <button key={s.key} onClick={() => setSort(s.key)} className={`brand-nav-item w-full text-left ${sort === s.key ? 'active' : ''}`}>
              {s.label}
            </button>
          ))}
        </div>

        {sourceType === 'social' && (
          <div className="panel p-3 space-y-1.5">
            <div className="section-title mb-1">Platforms</div>
            {PLATFORMS.map(p => (
              <label key={p} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(platforms, setPlatforms, p)} />
                <span className="capitalize">{p}</span>
              </label>
            ))}
          </div>
        )}

        <div className="panel p-3 space-y-1.5">
          <div className="section-title mb-1">Sentiment</div>
          {SENTIMENTS.map(s => (
            <label key={s} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
              <input type="checkbox" checked={sentiments.includes(s)} onChange={() => toggle(sentiments, setSentiments, s)} />
              <span className="capitalize">{s}</span>
            </label>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ─── Analytics (social + news + creators + competitors combined) ───
function AnalyticsTab({ brandId, realOnly }: { brandId: string; realOnly: boolean }) {
  const [stats, setStats] = useState<BrandMentionStats | null>(null);
  const [creators, setCreators] = useState<BrandCreator[]>([]);
  const [competitors, setCompetitors] = useState<BrandCompetitor[]>([]);
  const [competitorName, setCompetitorName] = useState('');

  function loadCompetitors() {
    fetch(`/api/brand/${brandId}/competitors`).then(r => r.json()).then(setCompetitors).catch(() => {});
  }

  useEffect(() => {
    const real = realOnly ? '?real=true' : '';
    fetch(`/api/brand/${brandId}/stats${real}`).then(r => r.json()).then(setStats).catch(() => {});
    fetch(`/api/brand/${brandId}/creators${real}`).then(r => r.json()).then(setCreators).catch(() => {});
    fetch(`/api/brand/${brandId}/competitors`).then(r => r.json()).then(setCompetitors).catch(() => {});
  }, [brandId, realOnly]);

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!competitorName.trim()) return;
    await fetch(`/api/brand/${brandId}/competitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: competitorName.trim() }) });
    setCompetitorName('');
    loadCompetitors();
  }

  async function removeCompetitor(id: string) {
    await fetch(`/api/brand/${brandId}/competitors/${id}`, { method: 'DELETE' });
    loadCompetitors();
  }

  if (!stats) return <div className="panel p-8 text-center text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Mentions" value={stats.mentions} icon={AtSign} />
        <StatTile label="Interactions" value={stats.interactions} icon={ThumbsUp} color="var(--info)" />
        <StatTile label="Health Score" value={stats.healthScore} icon={HeartHandshake} color="var(--warning)" format={n => `${n}/100`} />
        <StatTile label="Positive" value={stats.positive} icon={Smile} color="var(--success)" />
        <StatTile label="Negative" value={stats.negative} icon={Frown} color="var(--destructive)" />
      </div>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Sentiment Trend</h2></div>
        <div className="panel-body">
          <TrendChart
            data={stats.trend}
            xKey="date"
            lines={[
              { key: 'positive', color: 'var(--success)', label: 'Positive' },
              { key: 'negative', color: 'var(--destructive)', label: 'Negative' },
              { key: 'neutral', color: 'var(--muted-foreground)', label: 'Neutral' },
            ]}
          />
        </div>
      </section>

      <div className="grid md:grid-cols-3 gap-4">
        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Platform Breakdown</h2></div>
          <div className="panel-body"><BarBreakdown data={stats.platformBreakdown.map(p => ({ label: p.platform, count: p.count }))} height={180} /></div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Top Emotions</h2></div>
          <div className="panel-body space-y-2">
            {stats.emotionBreakdown.length === 0 ? <p className="text-sm text-muted-foreground">No data yet</p> : stats.emotionBreakdown.map(e => (
              <BreakdownBar key={e.emotion} label={e.emotion} count={e.count} total={stats.mentions} />
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Top Intents</h2></div>
          <div className="panel-body space-y-2">
            {stats.intentBreakdown.length === 0 ? <p className="text-sm text-muted-foreground">No data yet</p> : stats.intentBreakdown.map(i => (
              <BreakdownBar key={i.intent} label={i.intent} count={i.count} total={stats.mentions} />
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Top Creators</h2></div>
        <div className="panel-body">
          {creators.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No creator activity yet</p>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              {creators.map(c => (
                <div key={`${c.platform}:${c.author_handle}`} className="brand-stat-tile space-y-2">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={c.platform} />
                    <span className="text-sm font-medium truncate">{c.author_name || c.author_handle}</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>{c.mentionCount} mention{c.mentionCount === 1 ? '' : 's'}</div>
                    <div>{formatNumber(c.reach)} reach</div>
                    <div>{formatNumber(c.engagement)} engagement</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Tracked Competitors ({competitors.length})</h2></div>
        <div className="panel-body space-y-3">
          <form onSubmit={addCompetitor} className="flex gap-2">
            <input value={competitorName} onChange={e => setCompetitorName(e.target.value)} placeholder="Competitor name" className="flex-1 max-w-xs" />
            <button type="submit" className="brand-btn-primary btn btn-sm"><Plus size={13} /> Add</button>
          </form>
          {competitors.length === 0 ? (
            <div className="text-center py-6 space-y-1">
              <Trophy size={26} className="mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Add competitors to compare performance.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-3">
              {competitors.map(c => (
                <div key={c.id} className="brand-stat-tile flex items-center justify-between">
                  <span className="text-sm font-medium">{c.name}</span>
                  <button onClick={() => removeCompetitor(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function BreakdownBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="capitalize">{label}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--brand-coral)' }} />
      </div>
    </div>
  );
}

// ─── Campaigns ──────────────────────────────────────────────
function CampaignsTab({ brandId }: { brandId: string }) {
  const [campaigns, setCampaigns] = useState<BrandCampaign[]>([]);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');

  function load() {
    fetch(`/api/brand/${brandId}/campaigns`).then(r => r.json()).then(setCampaigns).catch(() => {});
  }
  useEffect(load, [brandId]);

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`/api/brand/${brandId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), keywords: keywords.split(',').map(k => k.trim()).filter(Boolean) }),
    });
    setName('');
    setKeywords('');
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/brand/${brandId}/campaigns/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="panel-header"><h2 className="section-title">New Campaign</h2></div>
        <div className="panel-body">
          <form onSubmit={createCampaign} className="flex flex-wrap gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Campaign name" className="flex-1 min-w-[160px]" />
            <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Keywords, comma-separated" className="flex-1 min-w-[220px]" />
            <button type="submit" className="brand-btn-primary btn btn-sm"><Plus size={13} /> Create Campaign</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Campaigns ({campaigns.length})</h2></div>
        <div className="panel-body">
          {campaigns.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Megaphone size={32} className="mx-auto text-muted-foreground" />
              <p className="font-semibold">No campaigns yet</p>
              <p className="text-sm text-muted-foreground">Create your first campaign to track and analyze keyword performance.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map(c => (
                <div key={c.id} className="brand-stat-tile flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.keywords.join(', ') || 'No keywords'} · created {formatDate(c.created_at)}</div>
                  </div>
                  <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Digests ────────────────────────────────────────────────
function DigestsTab({ brandId }: { brandId: string }) {
  const [digests, setDigests] = useState<BrandDigest[]>([]);
  const [active, setActive] = useState<BrandDigest | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch(`/api/brand/${brandId}/digests`).then(r => r.json()).then((data: BrandDigest[]) => {
      setDigests(data);
      if (data.length) setActive(data[0]);
    }).catch(() => {});
  }, [brandId]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/digests`, { method: 'POST' });
      const digest = await res.json();
      setDigests(prev => [digest, ...prev]);
      setActive(digest);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <section className="panel">
        <div className="panel-header">
          <h2 className="section-title">Digests</h2>
          <button onClick={generate} disabled={generating} className="brand-btn-primary btn btn-sm">
            <Sparkles size={13} /> {generating ? 'Generating…' : 'New'}
          </button>
        </div>
        <div className="panel-body space-y-1">
          {digests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No digests yet</p>
          ) : digests.map(d => (
            <button key={d.id} onClick={() => setActive(d)} className={`brand-nav-item w-full text-left flex-col items-start ${active?.id === d.id ? 'active' : ''}`}>
              <span className="font-medium truncate w-full">{d.title}</span>
              <span className="text-xs text-muted-foreground">{formatDate(d.period_start)} – {formatDate(d.period_end)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        {active ? (
          <div className="panel-body space-y-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Auto-generated summary — not AI-written</div>
            <h1 className="text-xl font-semibold">{active.title}</h1>
            <p className="text-sm text-muted-foreground">{formatDate(active.created_at)}</p>
            <div className="whitespace-pre-line text-sm leading-relaxed pt-2">{active.body}</div>
          </div>
        ) : (
          <div className="panel-body flex flex-col items-center justify-center text-center py-16 space-y-2">
            <FileText size={32} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generate a digest to see an auto-written summary of recent mention activity.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Alerts ─────────────────────────────────────────────────
function AlertsTab({ brandId }: { brandId: string }) {
  const [alerts, setAlerts] = useState<BrandAlert[]>([]);
  const [name, setName] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [checking, setChecking] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  function load() {
    fetch(`/api/brand/${brandId}/alerts`).then(r => r.json()).then(setAlerts).catch(() => {});
  }
  useEffect(load, [brandId]);

  async function createAlert(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`/api/brand/${brandId}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), filters: sentiment ? { sentiment } : {} }),
    });
    setName('');
    setSentiment('');
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/brand/${brandId}/alerts/${id}`, { method: 'DELETE' });
    load();
  }

  async function checkNow(id: string) {
    setChecking(id);
    try {
      const res = await fetch(`/api/brand/${brandId}/alerts/${id}/check`, { method: 'POST' });
      const data = await res.json();
      setResult(prev => ({ ...prev, [id]: `${data.matched} match${data.matched === 1 ? '' : 'es'} — check the notification bell.` }));
      load();
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="panel-header"><h2 className="section-title">New Alert</h2></div>
        <div className="panel-body">
          <form onSubmit={createAlert} className="flex flex-wrap gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Alert name (e.g. Negative Sentiment)" className="flex-1 min-w-[200px]" />
            <select value={sentiment} onChange={e => setSentiment(e.target.value)}>
              <option value="">Any sentiment</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <button type="submit" className="brand-btn-primary btn btn-sm"><Plus size={13} /> New Alert</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">{alerts.length} Alert{alerts.length === 1 ? '' : 's'}</h2></div>
        <div className="panel-body space-y-2">
          {alerts.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Bell size={32} className="mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No alerts configured yet.</p>
            </div>
          ) : alerts.map(a => (
            <div key={a.id} className="brand-stat-tile space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => checkNow(a.id)} disabled={checking === a.id} className="btn btn-ghost btn-sm">
                    <RadioTower size={12} /> {checking === a.id ? 'Checking…' : 'Check now'}
                  </button>
                  <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Filter: {a.filters.sentiment || 'any sentiment'} · last checked {a.last_checked_at ? formatDateTime(a.last_checked_at) : 'never'}
              </div>
              {result[a.id] && <div className="text-xs" style={{ color: 'var(--brand-coral)' }}>{result[a.id]}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
