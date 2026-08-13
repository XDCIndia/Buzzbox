'use client';

import { useEffect, useState } from 'react';
import { AtSign, ThumbsUp, HeartHandshake, Smile, Frown, Plus, Trash2, Trophy } from 'lucide-react';
import { StatTile } from '@/components/brand/stat-tile';
import { BarBreakdown } from '@/components/brand/bar-breakdown';
import { TrendChart } from '@/components/ui/trend-chart';
import { PlatformBadge } from '@/components/brand/platform-badge';
import { EmptyState } from '@/components/brand/empty-state';
import { formatNumber } from '@/lib/utils';
import type { BrandMentionStats, BrandCreator, BrandCompetitor } from '@/types';

export function AnalyticsTab({ brandId, realOnly }: { brandId: string; realOnly: boolean }) {
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
            <EmptyState icon={Trophy} description="Add competitors to compare performance." variant="compact" />
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
