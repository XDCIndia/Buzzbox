'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { FlaskConical, Lightbulb, CheckCircle2 } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useDashboard } from '@/store';
import type { Experiment, Learning } from '@/types';
import { parseAppliedTo } from '@/lib/experiments';

type Tab = 'current' | 'history' | 'learnings';

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [tab, setTab] = useState<Tab>('current');
  const { realOnly } = useDashboard();

  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false; // guard: a newer run (or unmount) must win over this response
    const realParam = realOnly ? '?real=true' : '';
    fetch(`/api/experiments${realParam}`)
      .then(r => { if (!r.ok) throw new Error('experiments'); return r.json(); })
      .then(data => {
        if (cancelled) return;
        setLoadError(false);
        setExperiments(data.experiments || []);
        setLearnings(data.learnings || []);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [realOnly, retryNonce]);

  const running = experiments.filter(e => e.status === 'running' || e.status === 'proposed');
  const completed = experiments.filter(e => e.status === 'completed');

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="08"
        eyebrow="Operate"
        title="Experiments"
        description="Running experiments, history, and captured learnings."
      />

      {loadError && (
        <ErrorState
          title="Couldn't load experiments"
          detail="The experiments service did not respond. Running experiments are unaffected — retry to refresh."
          onRetry={() => setRetryNonce(n => n + 1)}
        />
      )}

      {!loadError && (
      <div className="panel">
        <div className="panel-body !p-0">
          <div className="flex gap-0 border-b border-border">
            {([
              { key: 'current' as Tab, label: `Current (${running.length})` },
              { key: 'history' as Tab, label: `History (${completed.length})` },
              { key: 'learnings' as Tab, label: `Learnings (${learnings.length})` },
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
      )}

      {tab === 'current' && (
        <div className="space-y-4">
          {running.length === 0 ? (
            <div className="panel p-8">
              <EmptyState
                icon={FlaskConical}
                title="No experiments running"
                reason="Experiments let you test content angles, send times, or outreach copy and measure what actually moves the numbers."
                next="Log a new experiment to start tracking a hypothesis."
              />
            </div>
          ) : (
            running.map(exp => (
              <ExperimentCard key={exp.id} experiment={exp} />
            ))
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          {completed.length === 0 ? (
            <div className="panel p-8">
              <EmptyState
                icon={CheckCircle2}
                title="No completed experiments"
                reason="Experiments land here once they are marked done, with their outcome recorded."
                next="Complete a running experiment to archive its results."
              />
            </div>
          ) : (
            completed.map(exp => (
              <ExperimentCard key={exp.id} experiment={exp} />
            ))
          )}
        </div>
      )}

      {tab === 'learnings' && (
        <div className="space-y-3">
          {learnings.length === 0 ? (
            <div className="panel p-8">
              <EmptyState
                icon={Lightbulb}
                title="No validated learnings yet"
                reason="Learnings are captured insights from finished experiments — what worked, what didn't, and with what confidence."
                next="Capture a learning from a completed experiment."
              />
            </div>
          ) : (
            learnings.map(l => (
              <div key={l.id} className="panel card-hover p-4 flex gap-3">
                <Lightbulb size={18} className="text-warning mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm">{l.learning}</p>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    {l.validated_week && <span>Week {l.validated_week}</span>}
                    {l.confidence && <Badge status={l.confidence} />}
                    {l.applied_to && (
                      <span>Applied to: {parseAppliedTo(l.applied_to).join(', ')}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ExperimentCard({ experiment: exp }: { experiment: Experiment }) {
  return (
    <div className="panel card-hover p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-primary" />
          <span className="text-xs text-muted-foreground">Week {exp.week || '?'}</span>
        </div>
        <div className="flex gap-2">
          <Badge status={exp.status || 'proposed'} />
          {exp.decision && <Badge status={exp.decision} />}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Hypothesis</p>
          <p className="text-sm">{exp.hypothesis || '\u2014'}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Action</p>
            <p className="text-sm">{exp.action || '\u2014'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Metric</p>
            <p className="text-sm font-mono">{exp.metric || '\u2014'}</p>
          </div>
        </div>
        {exp.win_threshold && (
          <div>
            <p className="text-xs text-muted-foreground">Win Threshold</p>
            <p className="text-sm font-mono">{exp.win_threshold}</p>
          </div>
        )}
        {exp.results && (
          <div>
            <p className="text-xs text-muted-foreground">Results</p>
            <p className="text-sm">{exp.results}</p>
          </div>
        )}
        {exp.learning && (
          <div>
            <p className="text-xs text-muted-foreground">Learning</p>
            <p className="text-sm text-warning">{exp.learning}</p>
          </div>
        )}
        {exp.next_action && (
          <div>
            <p className="text-xs text-muted-foreground">Next Action</p>
            <p className="text-sm text-primary">{exp.next_action}</p>
          </div>
        )}
      </div>
    </div>
  );
}
