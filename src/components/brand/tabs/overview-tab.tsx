'use client';

import { useCallback, useEffect, useState } from 'react';
import { AtSign, Users2, ThumbsUp, HeartHandshake, MessageSquare } from 'lucide-react';
import { StatTile } from '@/components/brand/stat-tile';
import { BarBreakdown } from '@/components/brand/bar-breakdown';
import { TrendChart } from '@/components/ui/trend-chart';
import { MentionCard } from '@/components/brand/mention-card';
import { StatCardSkeleton, ChartSkeleton } from '@/components/ui/loading-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/brand/empty-state';
import type { BrandMention, BrandMentionStats } from '@/types';

export function OverviewTab({ brandId, realOnly }: { brandId: string; realOnly: boolean }) {
  const [stats, setStats] = useState<BrandMentionStats | null>(null);
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const real = realOnly ? '?real=true' : '';
    Promise.all([
      fetch(`/api/brand/${brandId}/stats${real}`).then(r => {
        if (!r.ok) throw new Error('Failed to load brand metrics');
        return r.json();
      }),
      fetch(`/api/brand/${brandId}/mentions?sort=popular${real ? '&real=true' : ''}`).then(r => {
        if (!r.ok) throw new Error('Failed to load brand mentions');
        return r.json();
      }),
    ])
      .then(([statsData, mentionsData]: [BrandMentionStats, BrandMention[]]) => {
        setStats(statsData);
        setMentions(Array.isArray(mentionsData) ? mentionsData.slice(0, 6) : []);
      })
      .catch(err => setError((err as Error).message || 'Failed to load brand overview.'))
      .finally(() => setLoading(false));
  }, [brandId, realOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function onPatch(id: string, patch: Record<string, string>) {
    setMentions(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as BrandMention : m)));
    fetch(`/api/brand/${brandId}/mentions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <ChartSkeleton height={200} />
          <ChartSkeleton height={200} />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <ErrorBanner
        title="Unable to load overview"
        message={error || 'Failed to fetch brand metrics'}
        explanation="Check network connection or try reloading."
        onRetry={loadData}
      />
    );
  }

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
            <EmptyState
              icon={MessageSquare}
              title="Start monitoring your brand"
              description="Connect your data source or trigger a sync to begin tracking brand mentions."
              primaryAction={{
                label: 'Go to Social Mentions',
                href: `/brand/${brandId}/mentions/social`,
              }}
              variant="compact"
            />
          ) : (
            mentions.map(m => <MentionCard key={m.id} mention={m} onPatch={onPatch} />)
          )}
        </div>
      </section>
    </div>
  );
}
