'use client';

import { useEffect, useState } from 'react';
import { TrendChart } from '@/components/ui/trend-chart';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/empty-state';
import { useDashboard } from '@/store';
import type { DailyMetrics, WeeklyKPI } from '@/types';

// 90-day targets from the plan
const TARGETS = {
  impressions: 50_000,
  engagement_rate: 3.0,
  reply_rate: 8.0,
  leads_added: 200,
  emails_sent: 500,
  calls_booked: 10,
};

export default function KPIsPage() {
  const [daily, setDaily] = useState<DailyMetrics[]>([]);
  const [weekly, setWeekly] = useState<WeeklyKPI[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const { realOnly } = useDashboard();

  useEffect(() => {
    let cancelled = false; // guard: a newer run (or unmount) must win over this response
    const realParam = realOnly ? '&real=true' : '';
    fetch(`/api/kpis?weeks=12${realParam}`)
      .then(r => { if (!r.ok) throw new Error('kpis'); return r.json(); })
      .then(data => {
        if (cancelled) return;
        setLoadError(false);
        setDaily(data.daily || []);
        setWeekly(data.weekly || []);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [realOnly, retryNonce]);

  const weeklyReversed = [...weekly].reverse();
  const thisWeek = weekly[0];
  const lastWeek = weekly[1];

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="10"
        eyebrow="Observe"
        title="KPIs"
        description="Weekly north-star metrics and trends."
      >
        <div className="text-xs text-muted-foreground">
          Weeks tracked <span className="font-mono text-foreground">{weekly.length}</span>
        </div>
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load KPI data"
          detail="The metrics service did not respond. Weekly trends and targets are unavailable until it's back."
          onRetry={() => setRetryNonce(n => n + 1)}
        />
      ) : (
      <>
      {/* Weekly metrics table */}
      <div className="panel">
        <div className="panel-header">
          <h3 className="section-title">Weekly Metrics</h3>
        </div>
        <div className="panel-body !p-0">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>This Week</th>
                <th>Last Week</th>
                <th>90-Day Target</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow label="Impressions" current={thisWeek?.impressions} prev={lastWeek?.impressions} target={TARGETS.impressions} />
              <MetricRow label="Engagement Rate" current={thisWeek?.engagement_rate} prev={lastWeek?.engagement_rate} target={TARGETS.engagement_rate} suffix="%" />
              <MetricRow label="Leads Added" current={thisWeek?.leads_added} prev={lastWeek?.leads_added} target={TARGETS.leads_added} />
              <MetricRow label="Emails Sent" current={thisWeek?.emails_sent} prev={lastWeek?.emails_sent} target={TARGETS.emails_sent} />
              <MetricRow label="Reply Rate" current={thisWeek?.reply_rate} prev={lastWeek?.reply_rate} target={TARGETS.reply_rate} suffix="%" />
              <MetricRow label="Calls Booked" current={thisWeek?.calls_booked} prev={lastWeek?.calls_booked} target={TARGETS.calls_booked} />
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel">
          <div className="panel-header"><h3 className="section-title">Impressions (weekly)</h3></div>
          <div className="panel-body">
          <TrendChart
            data={weeklyReversed.map(w => ({ week: w.week, impressions: w.impressions }))}
            xKey="week"
            lines={[{ key: 'impressions', color: 'var(--primary)', label: 'Impressions' }]}
          />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h3 className="section-title">Engagement Rate (weekly)</h3></div>
          <div className="panel-body">
          <TrendChart
            data={weeklyReversed.map(w => ({ week: w.week, rate: w.engagement_rate }))}
            xKey="week"
            lines={[{ key: 'rate', color: 'var(--success)', label: 'Engagement %' }]}
          />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h3 className="section-title">Leads & Sends (weekly)</h3></div>
          <div className="panel-body">
          <TrendChart
            data={weeklyReversed.map(w => ({ week: w.week, leads: w.leads_added, sends: w.emails_sent }))}
            xKey="week"
            lines={[
              { key: 'leads', color: 'var(--info)', label: 'Leads' },
              { key: 'sends', color: 'var(--warning)', label: 'Sends' },
            ]}
          />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h3 className="section-title">Reply Rate (weekly)</h3></div>
          <div className="panel-body">
          <TrendChart
            data={weeklyReversed.map(w => ({ week: w.week, reply: w.reply_rate }))}
            xKey="week"
            lines={[{ key: 'reply', color: 'var(--destructive)', label: 'Reply %' }]}
          />
          </div>
        </div>
      </div>

      {/* 90-day progress */}
      <div className="panel">
        <div className="panel-header">
          <h3 className="section-title">90-Day Goal Progress</h3>
        </div>
        <div className="panel-body">
        <div className="space-y-3">
          <ProgressBar label="Total Impressions" current={daily.reduce((s, d) => s + d.total_impressions, 0)} target={TARGETS.impressions} />
          <ProgressBar label="Total Leads" current={daily.reduce((s, d) => s + d.discoveries, 0)} target={TARGETS.leads_added} />
          <ProgressBar label="Total Sends" current={daily.reduce((s, d) => s + d.sends, 0)} target={TARGETS.emails_sent} />
          <ProgressBar label="Calls Booked" current={0} target={TARGETS.calls_booked} />
        </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function MetricRow({ label, current, prev, target, suffix = '' }: {
  label: string;
  current?: number;
  prev?: number;
  target: number;
  suffix?: string;
}) {
  const c = current ?? 0;
  const p = prev ?? 0;
  const diff = p > 0 ? ((c - p) / p) * 100 : 0;
  const up = diff >= 0;

  return (
    <tr>
      <td className="font-medium">{label}</td>
      <td className="font-mono">{c.toFixed(suffix === '%' ? 1 : 0)}{suffix}</td>
      <td className="font-mono text-muted-foreground">{p.toFixed(suffix === '%' ? 1 : 0)}{suffix}</td>
      <td className="font-mono text-muted-foreground">{target}{suffix}</td>
      <td>
        <span className={`text-xs font-mono ${up ? 'text-success' : 'text-destructive'}`}>
          {up ? '+' : ''}{diff.toFixed(1)}%
          {up ? ' \u2191' : ' \u2193'}
        </span>
      </td>
    </tr>
  );
}

function ProgressBar({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = Math.min((current / target) * 100, 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{current.toLocaleString()} / {target.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(pct, 1)}%`,
            background: pct >= 100 ? 'var(--success)' : pct >= 50 ? 'var(--primary)' : 'var(--warning)',
          }}
        />
      </div>
    </div>
  );
}
