'use client';

import { useEffect, useState, useCallback } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { SignalCard } from '@/components/ui/signal-card';
import { ExternalLink, Copy, Check, MessageCircle, Radar } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/utils';
import { useDashboard } from '@/store';
import type { Engagement, Signal } from '@/types';

type Tab = 'x' | 'linkedin' | 'signals';

export default function EngagementPage() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tab, setTab] = useState<Tab>('x');
  const [copied, setCopied] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { realOnly } = useDashboard();

  const loadEngagement = useCallback(() => {
    const realParam = realOnly ? '?real=true' : '';
    Promise.all([
      fetch(`/api/engagement${realParam}`).then(r => { if (!r.ok) throw new Error('engagement'); return r.json(); }),
      fetch(`/api/signals${realParam}`).then(r => { if (!r.ok) throw new Error('signals'); return r.json(); }),
    ])
      .then(([eng, sig]) => { setLoadError(false); setEngagements(eng); setSignals(sig); })
      .catch(() => setLoadError(true));
  }, [realOnly]);

  useEffect(() => { loadEngagement(); }, [loadEngagement]);

  const xEngagements = engagements.filter(e => e.platform === 'x');
  const linkedInQueue = engagements.filter(e => e.platform === 'linkedin' && e.action_type === 'comment');

  const copyText = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="04"
        eyebrow="Operate"
        title="Engagement"
        description="Replies, comments, and listening signals across platforms."
      >
        <div className="text-xs text-muted-foreground">
          X <span className="font-mono text-foreground">{xEngagements.length}</span>
          {' · '}
          LinkedIn <span className="font-mono text-foreground">{linkedInQueue.length}</span>
          {' · '}
          Signals <span className="font-mono text-foreground">{signals.length}</span>
        </div>
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load engagement data"
          detail="The engagement or signals service did not respond. Check that the sync service is running."
          onRetry={loadEngagement}
        />
      ) : (
      <>
      <div className="panel">
        <div className="panel-body !p-0">
      <div className="flex gap-0 border-b border-border">
        {([
          { key: 'x' as Tab, label: `X Activity (${xEngagements.length})` },
          { key: 'linkedin' as Tab, label: `LinkedIn Queue (${linkedInQueue.length})` },
          { key: 'signals' as Tab, label: `Signals (${signals.length})` },
        ]).map(t => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      </div>
      </div>

      {tab === 'x' && (
        <div className="panel">
          <div className="panel-header">
            <h3 className="section-title">X Activity</h3>
          </div>
          <div className="panel-body !p-0">
          <DataTable
            columns={[
              { key: 'action_type', label: 'Action', render: (r: Engagement) => <Badge status={r.action_type || 'reply'} /> },
              { key: 'target_username', label: 'Target', render: (r: Engagement) => (
                <span className="font-mono text-xs">@{r.target_username || '\u2014'}</span>
              )},
              { key: 'our_text', label: 'Text', render: (r: Engagement) => (
                <span className="text-sm max-w-md truncate block">{r.our_text || '\u2014'}</span>
              )},
              { key: 'target_url', label: 'Link', render: (r: Engagement) => r.target_url ? (
                <a href={r.target_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  <ExternalLink size={14} />
                </a>
              ) : null },
              { key: 'created_at', label: 'Time', render: (r: Engagement) => (
                <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span>
              )},
            ]}
            data={xEngagements}
            keyField="id"
            emptyIcon={ExternalLink}
            emptyTitle="No X activity yet"
            emptyDescription="Replies, likes, and mentions collected from X will appear here once the engagement agent runs."
            emptyMessage="No X engagements yet"
          />
          </div>
        </div>
      )}

      {tab === 'linkedin' && (
        <div className="space-y-3">
          {linkedInQueue.length === 0 ? (
            <div className="panel p-8">
              <EmptyState
                icon={MessageCircle}
                title="No LinkedIn comments queued"
                reason="Draft comments for LinkedIn posts appear here when the engagement agent finds relevant conversations."
                next="Connect LinkedIn or run a sync to populate the queue."
                variant="panel"
              />
            </div>
          ) : (
            linkedInQueue.map(item => (
              <div key={item.id} className="panel card-hover p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">@{item.target_username}</span>
                    {item.target_url && (
                      <a href={item.target_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary">
                        <ExternalLink size={12} className="inline" />
                      </a>
                    )}
                  </div>
                  <Badge status={item.status || 'pending'} />
                </div>
                <p className="text-sm bg-muted/30 p-3 rounded-lg font-mono">{item.our_text}</p>
                <div className="flex gap-2">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => copyText(item.our_text || '', item.id)}
                  >
                    {copied === item.id ? <Check size={12} /> : <Copy size={12} />}
                    {copied === item.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'signals' && (
        <div className="space-y-3">
          {signals.length === 0 ? (
            <div className="panel p-8">
              <EmptyState
                icon={Radar}
                title="No signals detected yet"
                reason="Listening signals are collected from monitored keywords and sources across social and news."
                next="Add brand keywords in Settings or run a research sync to start collecting."
                action={{ label: 'Open research', href: '/research' }}
              />
            </div>
          ) : (
            signals.slice(0, 50).map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
