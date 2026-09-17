'use client';

import { useEffect, useState } from 'react';
import { SignalCard } from '@/components/ui/signal-card';
import { PageHeader } from '@/components/ui/page-header';
import { useDashboard } from '@/store';
import type { Signal } from '@/types';

const SIGNAL_TYPES: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'pain', label: 'Pain' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'launch', label: 'Launch' },
  { key: 'competitor', label: 'Competitor' },
  { key: 'brand_mention', label: 'Brand Mention' },
  { key: 'opportunity', label: 'Opportunity' },
];

export default function ResearchPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [relevanceFilter, setRelevanceFilter] = useState('');
  const { realOnly } = useDashboard();

  useEffect(() => {
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    if (relevanceFilter) params.set('relevance', relevanceFilter);
    if (realOnly) params.set('real', 'true');
    const q = params.toString();
    fetch(`/api/signals${q ? '?' + q : ''}`).then(r => r.json()).then(setSignals).catch(() => {});
  }, [typeFilter, relevanceFilter, realOnly]);

  const todaySignals = signals.filter(s => s.date === new Date().toISOString().slice(0, 10));
  const otherSignals = signals.filter(s => s.date !== new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="09"
        eyebrow="Observe"
        title="Research"
        description="Collected signals from social and news monitoring."
      >
        <div className="flex gap-3">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            {SIGNAL_TYPES.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <select
            value={relevanceFilter}
            onChange={e => setRelevanceFilter(e.target.value)}
          >
            <option value="">All Relevance</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </PageHeader>

      {/* Today's signals */}
      {todaySignals.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h2 className="section-title">Today&apos;s Signals ({todaySignals.length})</h2>
          </div>
          <div className="panel-body space-y-3">
            {todaySignals.map(s => <SignalCard key={s.id} signal={s} />)}
          </div>
        </section>
      )}

      {/* Earlier signals */}
      <section className="panel">
        <div className="panel-header">
          <h2 className="section-title">
            {todaySignals.length > 0 ? 'Earlier' : 'All Signals'} ({otherSignals.length})
          </h2>
        </div>
        <div className="panel-body space-y-3">
          {otherSignals.length === 0 && todaySignals.length === 0 ? (
            <div className="panel p-8 text-center text-muted-foreground text-sm">
              No research signals yet
            </div>
          ) : (
            otherSignals.map(s => <SignalCard key={s.id} signal={s} />)
          )}
        </div>
      </section>
    </div>
  );
}
