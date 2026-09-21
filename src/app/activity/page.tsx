'use client';

import { useEffect, useState } from 'react';
import { PenLine, MessageCircle, Mail, Search, Info, Activity } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { timeAgo } from '@/lib/utils';
import { useDashboard } from '@/store';
import type { ActivityEntry } from '@/types';

const ACTION_FILTERS = [
  { key: '', label: 'All Actions' },
  { key: 'post', label: 'Post' },
  { key: 'engage', label: 'Engage' },
  { key: 'discover', label: 'Discover' },
  { key: 'send', label: 'Send' },
  { key: 'triage', label: 'Triage' },
  { key: 'research', label: 'Research' },
];

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const { realOnly } = useDashboard();

  useEffect(() => {
    let cancelled = false; // guard: a newer run (or unmount) must win over this response
    const params = new URLSearchParams();
    if (filter) params.set('action', filter);
    params.set('limit', '200');
    if (realOnly) params.set('real', 'true');
    fetch(`/api/activity?${params}`)
      .then(r => { if (!r.ok) throw new Error('activity'); return r.json(); })
      .then(entries => { if (!cancelled) { setLoadError(false); setEntries(entries); } })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [filter, realOnly, retryNonce]);

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="16"
        eyebrow="System"
        title="Activity log"
        description="Every action across agents, content, and outreach."
      >
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost text-xs"
            onClick={() => {
              const params = new URLSearchParams();
              if (filter) params.set('action', filter);
              params.set('limit', '500');
              if (realOnly) params.set('real', 'true');
              params.set('format', 'csv');
              window.open(`/api/activity?${params.toString()}`, '_blank', 'noopener,noreferrer');
            }}
          >
            Export CSV
          </button>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            {ACTION_FILTERS.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load activity"
          detail="The activity service did not respond. Recent events may still be recorded — retry to refresh."
          onRetry={() => setRetryNonce(n => n + 1)}
        />
      ) : (
      <div className="panel">
        <div className="panel-body space-y-0">
          {entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Activity}
                title="No activity logged yet"
                reason="Every publish, reply, approval, and agent action is recorded here as it happens."
                next="Run an agent job or publish content to see the first entries."
              />
            </div>
          ) : (
            groupByDay(entries).map(group => (
              <div key={group.day}>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground py-2">
                  {group.day}
                </div>
                {group.items.map((entry, i) => (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-4 py-3 ${
                      i < group.items.length - 1 ? 'border-b border-border/30' : ''
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <ActionIcon action={entry.action} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.action && (
                            <span className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${severityClass(entry.action)}`}>
                              {entry.action}
                            </span>
                          )}
                          <span className="text-sm">{entry.detail || '\u2014'}</span>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(entry.ts)}
                        </span>
                      </div>
                      {entry.result && (
                        <p className="text-xs text-success mt-1">{entry.result}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function ActionIcon({ action }: { action: string | null }) {
  const size = 14;
  const iconMap: Record<string, React.ReactNode> = {
    post: <PenLine size={size} />,
    engage: <MessageCircle size={size} />,
    send: <Mail size={size} />,
    discover: <Search size={size} />,
    research: <Search size={size} />,
    triage: <Activity size={size} />,
  };
  return <>{iconMap[action || ''] || <Info size={size} />}</>;
}

function severityClass(action: string) {
  const type = action.toLowerCase();
  if (type.includes('fail') || type.includes('error') || type.includes('reject')) {
    return 'bg-destructive/15 text-destructive';
  }
  if (type.includes('warn') || type.includes('triage')) {
    return 'bg-warning/15 text-warning';
  }
  if (type.includes('discover') || type.includes('research')) {
    return 'bg-info/15 text-info';
  }
  return 'bg-primary/10 text-primary';
}

function groupByDay(items: ActivityEntry[]) {
  const groups: { day: string; items: ActivityEntry[] }[] = [];
  const byDay = new Map<string, ActivityEntry[]>();
  for (const entry of items) {
    const day = entry.ts ? new Date(entry.ts).toLocaleDateString() : 'Unknown';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }
  for (const [day, groupItems] of byDay.entries()) {
    groups.push({ day, items: groupItems });
  }
  return groups;
}
