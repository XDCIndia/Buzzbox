'use client';

import { useEffect, useState } from 'react';
import { AtSign, Users2, ThumbsUp, HeartHandshake } from 'lucide-react';
import { StatTile } from '@/components/brand/stat-tile';
import { BarBreakdown } from '@/components/brand/bar-breakdown';
import { TrendChart } from '@/components/ui/trend-chart';
import { MentionCard } from '@/components/brand/mention-card';
import type { BrandMention, BrandMentionStats } from '@/types';

export function OverviewTab({ brandId, realOnly }: { brandId: string; realOnly: boolean }) {
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
