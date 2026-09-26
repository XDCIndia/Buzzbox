'use client';

import { useEffect, useState } from 'react';
import {
  PenLine, MessageCircle, Mail, Users, AlertTriangle, Info, AlertCircle,
  Bell, ThumbsUp, ThumbsDown, Loader2, Zap, Search, Send, CheckCircle,
  TrendingUp, Inbox, BarChart3, Activity,
} from 'lucide-react';
import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { TrendChart } from '@/components/ui/trend-chart';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { SetupChecklist, BuzzActionRow, NeedsAttention, GoingOutToday } from '@/components/dashboard/dashboard-widgets';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { formatNumber, timeAgo } from '@/lib/utils';
import { DEFAULT_BRAND_ID } from '@/lib/brand-constants';
import { toast } from '@/components/ui/toast';
import type { OverviewStats, Alert, ActivityEntry, DailyMetrics } from '@/types';
import { PipelineFunnel } from '@/components/pipeline/pipeline-funnel';
import { AgentSessions } from '@/components/sessions/agent-sessions';

interface AgentBrief {
  id: string;
  name: string;
  emoji: string;
  status: string;
  model: string;
  last_action?: string;
  last_action_at?: string;
  actions_today: number;
  next_job?: string;
  next_job_time?: string;
}

interface ActionItem {
  id: string;
  type: 'content' | 'sequence';
  title: string;
  subtitle: string;
  tier?: string;
  created_at: string;
}

interface XBudget {
  date: string;
  calls: number;
  posts: number;
  daily_search_limit: number;
  daily_post_limit: number;
  search_remaining: number;
  post_remaining: number;
}

interface OverviewData {
  stats: OverviewStats;
  alerts: Alert[];
  recentActivity: ActivityEntry[];
  metrics: DailyMetrics[];
  agents?: AgentBrief[];
  action_items?: ActionItem[];
}

type Role = 'admin' | 'editor' | 'viewer';

interface CycleTimeBenchmarkPayload {
  metric: string;
  days: number;
  baseline_mode: 'rolling_window' | 'launch_anchored';
  window: {
    before: { start: string; end: string };
    after: { start: string; end: string };
    now: string;
    launch_at: string | null;
  };
  before: { n: number; medianHours: number | null; p90Hours: number | null };
  after: { n: number; medianHours: number | null; p90Hours: number | null };
  delta: { median_pct: number | null; p90_pct: number | null };
}

export default function OverviewPage() {
  const { realOnly } = useDashboard();
  const realParam = realOnly ? '?real=true' : '';
  const [refreshKey, setRefreshKey] = useState(0);
  const [role, setRole] = useState<Role>('viewer');

  const { data, loading } = useSmartPoll<OverviewData>(
    () => fetch(`/api/overview${realParam}`).then(r => r.json()),
    { interval: 30_000, key: `${realOnly}-${refreshKey}` },
  );

  const { data: budget } = useSmartPoll<XBudget>(
    () => fetch('/api/x-budget').then(r => r.json()),
    { interval: 60_000 },
  );

  const { data: cycleBenchmark } = useSmartPoll<CycleTimeBenchmarkPayload>(
    () => fetch(`/api/benchmarks/cycle-time?days=30${realOnly ? '&real=true' : ''}`).then(r => r.json()),
    { interval: 300_000, key: `cycle-${realOnly}` },
  );

  // Scheduled content for the "Going out next" widget
  const { data: calendar } = useSmartPoll<{ items: { id: string; text_preview: string; platform: string; scheduled_for: string | null }[] }>(
    () => fetch('/api/content-calendar').then(r => r.json()),
    { interval: 60_000 },
  );

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((payload) => setRole(payload?.user?.role === 'admin' || payload?.user?.role === 'editor' ? payload.user.role : 'viewer'))
      .catch(() => setRole('viewer'));
  }, []);

  // Start sync service once
  useEffect(() => { fetch('/api/sync').catch(() => {}); }, []);

  if (!data || loading) {
    return <PageSkeleton />;
  }

  const { stats, alerts, recentActivity, metrics, agents, action_items } = data;
  const canEdit = role === 'admin' || role === 'editor';

  const metricsReversed = [...metrics].reverse();
  const impressionData = metricsReversed.map(m => ({ date: m.date, value: m.total_impressions }));
  const engagementData = metricsReversed.map(m => ({ date: m.date, value: m.total_engagement }));
  const sendsData = metricsReversed.map(m => ({ date: m.date, value: m.sends }));

  const pendingActions = action_items ?? [];
  const hasBudget = budget && !('error' in budget);

  // Day-over-day deltas for KPI cards (null when no baseline exists)
  const dayDelta = (series: { value: number }[]): number | null => {
    if (!series || series.length < 2) return null;
    const last = series[series.length - 1].value;
    const prev = series[series.length - 2].value;
    if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
    return ((last - prev) / prev) * 100;
  };

  return (
    <div className="animate-in">
      {/* Header zone texture — dotted grid, like the landing */}
      <div
        aria-hidden
        className="-m-3 sm:-m-5 mb-6 pt-8 pb-6 px-3 sm:px-5 border-b border-border/60"
        style={{
          backgroundImage: 'radial-gradient(color-mix(in srgb, var(--foreground) 7%, transparent) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, black 30%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 30%, transparent 100%)',
        }}
      >
        <div className="max-w-3xl">
          <p className="console-eyebrow mb-2">Workspace pulse</p>
          <p className="text-sm text-muted-foreground">
            {stats.posts_today + stats.engagement_today + stats.emails_sent} actions today · {' '}
            {pendingActions.length} waiting on you · {agents?.length ?? 0} agents on the roster
          </p>
        </div>
      </div>

      {/* COMMAND CENTER HEADER */}
      <PageHeader
        index="01"
        eyebrow="Command center"
        title="Operational overview"
        description="Real-time status of your marketing operations, agents, and pipeline."
        action={{ label: 'Content Queue', href: '/content', icon: <Inbox size={16} /> }}
      >
        <Link href="/outreach" className="btn btn-ghost btn-lg">Approvals</Link>
      </PageHeader>

      {/* BUZZ QUICK ACTIONS */}
      <div className="mb-6">
        <BuzzActionRow />
      </div>

      {/* NEEDS ATTENTION — surfaces before everything else */}
      {pendingActions.length > 0 && (
        <div className="mb-6">
          <NeedsAttention pending={pendingActions.length} />
        </div>
      )}

      {/* TODAY'S OPERATIONS — unified status bar (setup checklist while workspace is empty) */}
      <section className="space-y-4 mb-8 lg:mb-10">
        <SectionHeader title="Today's Operations" description="Key activity across posts, engagement, outreach, and pipeline" />
        {stats.posts_today === 0 && stats.engagement_today === 0 && stats.emails_sent === 0 && stats.pipeline_count === 0 ? (
          <SetupChecklist />
        ) : (
          <div className="metric-bar">
            <MetricColumn
              label="Posts Today"
              value={stats.posts_today}
              icon={PenLine}
              color="var(--primary)"
              href="/content"
              sparkline={impressionData.slice(-14).map(d => ({ value: d.value }))}
            />
            <MetricColumn
              label="Engagements Today"
              value={stats.engagement_today}
              icon={MessageCircle}
              color="var(--success)"
              delta={dayDelta(engagementData)}
              href="/engagement"
              sparkline={engagementData.slice(-14).map(d => ({ value: d.value }))}
            />
            <MetricColumn
              label="Emails Sent"
              value={stats.emails_sent}
              icon={Mail}
              color="var(--warning)"
              delta={dayDelta(sendsData)}
              href="/outreach"
              sparkline={sendsData.slice(-14).map(d => ({ value: d.value }))}
            />
            {/* Pipeline shows the point-in-time CRM count with no trend: the
                only nearby series is daily discoveries, and labeling that
                delta/sparkline as pipeline movement would mislead (#139). */}
            <MetricColumn
              label="Pipeline"
              value={stats.pipeline_count}
              icon={Users}
              color="var(--info)"
              href="/crm"
            />
          </div>
        )}
      </section>

      {/* OPERATIONS — agent status / action items / API budget */}
      <section className="space-y-4 mb-10 lg:mb-12">
        <SectionHeader title="Operations" description="Agents, approvals, and API budget" />
        <div className="rounded-xl border border-border bg-surface-1 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3">
            {/* Agents + Actions share the wider left panel */}
            <div className="lg:col-span-2 p-5 lg:p-6 space-y-6">
              {/* Agent Status */}
              <div className="space-y-4">
                <h3 className="section-heading flex items-center gap-1.5">
                  <span className="w-4 h-4">
                    <BotIcon />
                  </span>
                  Agent Status
                </h3>
                {agents && agents.length > 0 ? (
                  <div className="space-y-0.5">
                    {agents.map(agent => (
                      <Link
                        key={agent.id}
                        href="/agents/squads"
                        className="group flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl hover:bg-surface-2/40 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-xl shrink-0">
                          {agent.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{agent.name}</span>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              agent.status === 'active' ? 'bg-success' :
                              agent.status === 'idle' ? 'bg-warning' :
                              agent.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground'
                            }`} />
                            <span className="text-xs text-muted-foreground capitalize">{agent.status}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span className="font-mono">{agent.actions_today} actions today</span>
                            {agent.last_action_at && (
                              <span className="truncate">Last: {timeAgo(agent.last_action_at)}</span>
                            )}
                          </div>
                        </div>
                        {agent.next_job && (
                          <div className="text-right shrink-0 hidden sm:block">
                            <div className="text-[11px] text-muted-foreground">Next</div>
                            <div className="text-xs font-medium">{agent.next_job}</div>
                            {agent.next_job_time && (
                              <div className="text-[11px] text-muted-foreground font-mono">{agent.next_job_time}</div>
                            )}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState variant="inline"
                    icon={Zap}
                    title="No agents running"
                    reason="Agents will appear here once they are scheduled and begin work."
                    action={{ label: 'View Squads', href: '/agents/squads' }}
                  />
                )}
              </div>

              <div className="h-px bg-border/60" />

              {/* Action Items */}
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="section-heading flex items-center gap-1.5">
                    <AlertTriangle size={14} />
                    Action Items
                  </h3>
                  {pendingActions.length > 0 && (
                    <span className="text-xs bg-warning/15 text-warning px-2 py-0.5 rounded-full font-semibold">
                      {pendingActions.length}
                    </span>
                  )}
                </div>
                {pendingActions.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Needs your review</span>
                      <Link href="/content" className="text-primary hover:underline">Content Queue</Link>
                      <Link href="/outreach" className="text-primary hover:underline">Outreach</Link>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {pendingActions.map(item => (
                        <ActionItemCard
                          key={item.id}
                          item={item}
                          canEdit={canEdit}
                          onAction={() => setRefreshKey(k => k + 1)}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState variant="inline"
                    icon={CheckCircle}
                    title="All caught up"
                    reason="No pending approvals. New content and outreach will appear here when they need review."
                    action={{ label: 'Review Outreach', href: '/outreach' }}
                  />
                )}
              </div>
            </div>

            {/* Budget panel */}
            <div className="p-5 lg:p-6 border-t lg:border-t-0 lg:border-l border-border/60 space-y-5">
              <h3 className="section-heading flex items-center gap-1.5">
                <Search size={14} />
                X API Budget
              </h3>
              {hasBudget ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Daily usage</span>
                    <span className="text-xs text-muted-foreground font-mono">{budget.date}</span>
                  </div>
                  <div className="space-y-5 pt-1">
                    <BudgetBar
                      label="Search"
                      used={budget.calls}
                      limit={budget.daily_search_limit}
                      icon={<Search size={16} />}
                    />
                    <BudgetBar
                      label="Posts"
                      used={budget.posts}
                      limit={budget.daily_post_limit}
                      icon={<Send size={16} />}
                    />
                  </div>
                  <div className="pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Activity size={13} />
                    <span>Remaining: {budget.search_remaining} search · {budget.post_remaining} posts</span>
                  </div>
                </>
              ) : (
                <EmptyState variant="inline"
                  icon={Search}
                  title="No budget data"
                  reason="X API budget will appear once usage tracking is configured."
                  action={{ label: 'Integrations', href: '/integrations' }}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CAMPAIGN CYCLE TIME — compact insight strip */}
      <CycleTimeBenchmarkPanel data={cycleBenchmark || undefined} />

      {/* PERFORMANCE TRENDS — dominant visualization */}
      <section className="space-y-4 mb-10 lg:mb-12">
        <SectionHeader title="Performance Trends" description="Last 12 weeks" />
        <div className="rounded-xl border border-border bg-surface-1 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3">
            <div className="lg:col-span-2 p-5 lg:p-6 flex flex-col space-y-4">
              <h3 className="section-heading flex items-center gap-1.5">
                <BarChart3 size={14} />
                Impressions, Engagement & Sends
              </h3>
              <div className="flex-1 min-h-[260px]">
                <TrendChart
                  data={metricsReversed.map(m => ({
                    date: m.date.slice(5),
                    impressions: m.total_impressions,
                    engagement: m.total_engagement,
                    sends: m.sends,
                  }))}
                  xKey="date"
                  lines={[
                    { key: 'impressions', color: 'var(--primary)', label: 'Impressions' },
                    { key: 'engagement', color: 'var(--success)', label: 'Engagement' },
                    { key: 'sends', color: 'var(--warning)', label: 'Sends' },
                  ]}
                />
              </div>
            </div>
            <div className="p-5 lg:p-6 border-t lg:border-t-0 lg:border-l border-border/60 space-y-5">
              <h3 className="section-heading flex items-center gap-1.5">
                <TrendingUp size={14} />
                Latest snapshot
              </h3>
              {metricsReversed.length > 0 ? (
                <div className="space-y-4">
                  <SnapshotRow label="Impressions" value={metricsReversed[metricsReversed.length - 1]?.total_impressions ?? 0} color="bg-primary" />
                  <SnapshotRow label="Engagement" value={metricsReversed[metricsReversed.length - 1]?.total_engagement ?? 0} color="bg-success" />
                  <SnapshotRow label="Sends" value={metricsReversed[metricsReversed.length - 1]?.sends ?? 0} color="bg-warning" />
                  <p className="text-xs text-muted-foreground pt-2">
                    Trends update as campaigns and agents record activity. Switch to &quot;Real&quot; data in the header to exclude seeded samples.
                  </p>
                </div>
              ) : (
                <EmptyState variant="inline"
                  icon={BarChart3}
                  title="No trend data yet"
                  reason="Performance trends will appear once activity is recorded."
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* PIPELINE & CONTENT — bento: funnel + going-out-next + sessions */}
      <section className="space-y-4 mb-10 lg:mb-12">
        <SectionHeader title="Pipeline & Content" description="Funnel, what's going out, and agent sessions" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <PipelineFunnel />
          </div>
          <GoingOutToday items={calendar?.items ?? []} />
        </div>
        <AgentSessions />
      </section>

      {/* RECENT ACTIVITY + ALERTS — footer strip */}
      <section className="border-t border-border/60 pt-6 mt-10 lg:mt-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-0">
          <div className="lg:pr-8">
            <h3 className="section-heading flex items-center gap-1.5 mb-4">
              <Bell size={14} />
              Recent Activity
            </h3>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {recentActivity.length === 0 ? (
                <EmptyState variant="inline"
                  icon={Bell}
                  title="No activity yet"
                  reason="Marketing actions will appear here once campaigns and agents start running."
                  action={{ label: 'Create Campaign', href: `/brand/${DEFAULT_BRAND_ID}/create/campaigns` }}
                />
              ) : (
                recentActivity.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0">
                    <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center shrink-0 mt-0.5">
                      <ActionIcon action={entry.action} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{entry.detail || entry.action}</p>
                      <p className="text-xs text-muted-foreground">{timeAgo(entry.ts)}</p>
                    </div>
                    {entry.result && (
                      <span className="text-xs text-success">{entry.result}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:pl-8 lg:border-l border-border/60">
            <h3 className="section-heading flex items-center gap-1.5 mb-4">
              <AlertTriangle size={14} />
              Alerts
            </h3>
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <EmptyState variant="inline"
                  icon={CheckCircle}
                  title="All clear"
                  reason="No active alerts. We'll surface issues here if anything needs attention."
                />
              ) : (
                alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3.5 rounded-xl ${
                      alert.type === 'error' ? 'bg-destructive/10' :
                      alert.type === 'warning' ? 'bg-warning/10' :
                      'bg-info/10'
                    }`}
                  >
                    {alert.type === 'error' && <AlertCircle size={18} className="text-destructive mt-0.5" />}
                    {alert.type === 'warning' && <AlertTriangle size={18} className="text-warning mt-0.5" />}
                    {alert.type === 'info' && <Info size={18} className="text-info mt-0.5" />}
                    <p className="text-sm leading-relaxed">{alert.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SnapshotRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-base font-semibold font-mono">{formatNumber(value)}</span>
    </div>
  );
}

function MetricColumn({
  label,
  value,
  icon: Icon,
  sparkline,
  delta,
  href,
  color = 'var(--primary)',
}: {
  label: string;
  value: number;
  icon: typeof PenLine;
  sparkline?: { value: number }[];
  delta?: number | null;
  href?: string;
  color?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label">{label}</p>
          <p className="mt-2.5 text-3xl font-semibold tracking-tight font-mono text-foreground group-hover:text-primary transition-colors">
            {formatNumber(value)}
          </p>
          {delta !== null && delta !== undefined && (
            <p className={`mt-1 text-[11px] font-mono font-medium ${delta >= 0 ? 'text-success' : 'text-warning'}`}>
              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% vs yesterday
            </p>
          )}
        </div>
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 10%, var(--surface-2))`, color }}
        >
          <Icon size={18} />
        </div>
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="h-10 mt-3">
          {/* Fixed pixel height (matches h-10) instead of "100%" so Recharts has a
              real, non-percentage size to measure on first mount -- a percentage
              height resolves to the ResponsiveContainer's -1 initial dimension
              before ResizeObserver fires, which triggers its zero-size warning. */}
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={sparkline}>
              <defs>
                <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="95%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#gradient-${label})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );

  if (!href) return <div className="metric-bar-item group">{body}</div>;

  return (
    <Link href={href} className="metric-bar-item group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {body}
    </Link>
  );
}

function BotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="20" height="13" x="2" y="8" rx="2" />
      <path d="M2 14h20" />
      <path d="M6 14v4" />
      <path d="M10 14v4" />
      <path d="M14 14v4" />
      <path d="M18 14v4" />
    </svg>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="section-heading">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}


function BudgetBar({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: React.ReactNode }) {
  const pct = Math.min(100, (used / limit) * 100);
  const isHigh = pct >= 80;
  const isDepleted = pct >= 100;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-2.5">
        <span className="flex items-center gap-2 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className={`font-mono font-medium ${isDepleted ? 'text-destructive' : isHigh ? 'text-warning' : 'text-foreground'}`}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isDepleted ? 'bg-destructive' : isHigh ? 'bg-warning' : 'bg-primary'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatHours(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value < 1) return `${Math.round(value * 60)}m`;
  return `${value.toFixed(1)}h`;
}

function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return '—';
  const rounded = Math.round(deltaPct * 10) / 10;
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded}%`;
}

function CycleTimeBenchmarkPanel({ data }: { data?: CycleTimeBenchmarkPayload }) {
  const hasData = data && (data.before.n > 0 || data.after.n > 0);

  if (!data) return null;

  return (
    <section className="space-y-4 mb-8 lg:mb-10">
      <SectionHeader
        title="Campaign Cycle Time"
        description="Lead → approved campaign"
      />
      {hasData ? (
        <div className="rounded-xl border border-border bg-surface-1 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Before median</div>
              <div className="text-xl font-mono font-semibold mt-1">{formatHours(data.before.medianHours)}</div>
            </div>
            <span className="text-muted-foreground">→</span>
            <div>
              <div className="text-xs text-muted-foreground">After median</div>
              <div className="text-xl font-mono font-semibold mt-1">{formatHours(data.after.medianHours)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Median change</div>
              <div className={`text-xl font-mono font-semibold mt-1 ${(data.delta.median_pct ?? -1) >= 0 ? 'text-success' : 'text-warning'}`}>
                {formatDelta(data.delta.median_pct)}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            n before {data.before.n} · n after {data.after.n} · {data.baseline_mode === 'launch_anchored' ? 'launch anchored' : `rolling ${data.days}d`}
          </div>
        </div>
      ) : (
        <EmptyState variant="inline"
          icon={TrendingUp}
          title="No cycle data yet"
          reason="Campaign cycle metrics will appear once leads move through the campaign workflow."
          action={{ label: 'View CRM', href: '/crm' }}
        />
      )}
    </section>
  );
}

function ActionItemCard({ item, onAction, canEdit }: { item: ActionItem; onAction: () => void; canEdit: boolean }) {
  const [acting, setActing] = useState<string | null>(null);

  async function handleAction(action: 'approve' | 'reject') {
    if (!canEdit) return;
    setActing(action);
    try {
      if (item.type === 'content') {
        const res = await fetch('/api/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, status: action === 'approve' ? 'ready' : 'rejected' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(String(data?.error || `Request failed (${res.status})`));
        }
      } else {
        const res = await fetch('/api/sequences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, status: action === 'approve' ? 'approved' : 'cancelled' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(String(data?.error || `Request failed (${res.status})`));
        }
      }
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
      onAction();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to update');
    }
    setActing(null);
  }

  return (
    <div className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-xl hover:bg-surface-2/30 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-surface-1 border border-border flex items-center justify-center shrink-0">
        {item.type === 'content' ? <PenLine size={15} /> : <Mail size={15} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{item.title}</span>
          {item.tier && (
            <span className="text-xs bg-surface-1 border border-border px-1.5 py-0.5 rounded text-muted-foreground">Tier {item.tier}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => handleAction('approve')}
            disabled={acting !== null}
            className="flex items-center gap-1 text-xs font-medium bg-success/15 text-success hover:bg-success/25 px-2.5 py-1.5 rounded transition-colors disabled:opacity-50"
            title="Approve"
          >
            {acting === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
          </button>
          <button
            onClick={() => handleAction('reject')}
            disabled={acting !== null}
            className="flex items-center gap-1 text-xs font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 px-2.5 py-1.5 rounded transition-colors disabled:opacity-50"
            title="Reject"
          >
            {acting === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
          </button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0">read-only</span>
      )}
    </div>
  );
}

function ActionIcon({ action }: { action: string | null }) {
  const size = 14;
  switch (action) {
    case 'post': return <PenLine size={size} />;
    case 'engage': return <MessageCircle size={size} />;
    case 'send': return <Mail size={size} />;
    case 'alert': return <Bell size={size} />;
    default: return <Info size={size} />;
  }
}

function PageSkeleton() {
  return (
    <div className="space-y-10 lg:space-y-12 animate-in">
      <div className="h-10 w-48 bg-muted rounded-lg animate-pulse" />
      <div className="metric-bar">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="metric-bar-item h-36 animate-pulse bg-muted/10" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-surface-1 h-80 animate-pulse bg-muted/10" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card h-80 animate-pulse bg-muted/10" />
        <div className="card h-80 animate-pulse bg-muted/10" />
      </div>
    </div>
  );
}
