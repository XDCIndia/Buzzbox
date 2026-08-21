'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Zap, Clock, CheckCircle, AlertTriangle, Mail, PenLine,
  Calendar, Activity, Timer, ThumbsUp, ThumbsDown, Loader2,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { timeAgo } from '@/lib/utils';
import type { ApprovalItem, SkillExecution } from '@/types';

interface ScheduleJob {
  id: string;
  label: string;
  skill: string;
  schedule: string;
  cron: string;
  days?: string[];
  agent: string;
  agentName: string;
  agentEmoji: string;
}

interface AutomationsData {
  approvals: ApprovalItem[];
  skill_executions: SkillExecution[];
  schedule: ScheduleJob[];
  hourly_activity: { hour: number; c: number }[];
  summary: {
    pending_approvals: number;
    total_executions_30d: number;
    active_cron_jobs: number;
  };
}

interface AgentStyleToken {
  borderClass: string;
  dotClass: string;
  barClass: string;
  bgClass: string;
}

const AGENT_STYLE_TOKENS: AgentStyleToken[] = [
  { borderClass: 'border-l-primary', dotClass: 'bg-primary', barClass: 'bg-primary/60', bgClass: 'bg-primary/10' },
  { borderClass: 'border-l-success', dotClass: 'bg-success', barClass: 'bg-success/60', bgClass: 'bg-success/10' },
  { borderClass: 'border-l-warning', dotClass: 'bg-warning', barClass: 'bg-warning/60', bgClass: 'bg-warning/10' },
  { borderClass: 'border-l-destructive', dotClass: 'bg-destructive', barClass: 'bg-destructive/60', bgClass: 'bg-destructive/10' },
];

function toTitleFromId(agent: string): string {
  if (!agent) return 'Unknown';
  return agent
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

type Role = 'admin' | 'editor' | 'viewer';

export default function AutomationsPage() {
  const { realOnly } = useDashboard();
  const realParam = realOnly ? '?real=true' : '';
  const [role, setRole] = useState<Role>('viewer');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((payload) => setRole(payload?.user?.role === 'admin' || payload?.user?.role === 'editor' ? payload.user.role : 'viewer'))
      .catch(() => setRole('viewer'));
  }, []);

  const { data, loading, refetch } = useSmartPoll<AutomationsData>(
    () => fetch(`/api/automations${realParam}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  if (!data || loading) {
    return (
      <div className="space-y-6 animate-in">
        <h1 className="text-xl font-semibold">Automations</h1>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="panel h-32 animate-pulse bg-muted/20" />)}
        </div>
      </div>
    );
  }

  const { approvals, skill_executions, schedule, hourly_activity, summary } = data;
  const canEdit = role === 'admin' || role === 'editor';
  const knownAgents = new Map(
    schedule
      .filter((job) => job.agent)
      .map((job) => [job.agent, { name: job.agentName, emoji: job.agentEmoji }] as const),
  );
  const orderedAgentIds = Array.from(
    new Set([
      ...schedule.map((job) => job.agent).filter(Boolean),
      ...skill_executions.map((execution) => execution.agent).filter(Boolean),
      ...approvals.map((approval) => approval.agent).filter(Boolean),
    ]),
  );
  const agentStyles = Object.fromEntries(
    orderedAgentIds.map((agent, index) => [agent, AGENT_STYLE_TOKENS[index % AGENT_STYLE_TOKENS.length]]),
  ) as Record<string, AgentStyleToken>;
  const fallbackStyle = AGENT_STYLE_TOKENS[0];

  return (
    <div className="space-y-6 animate-in">
      <h1 className="text-xl font-semibold">Automations</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-tile flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-warning/15 flex items-center justify-center">
            <AlertTriangle size={18} className="text-warning" />
          </div>
          <div>
            <div className="text-2xl font-semibold font-mono">{summary.pending_approvals}</div>
            <div className="text-xs text-muted-foreground">Pending Approvals</div>
          </div>
        </div>
        <div className="stat-tile flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Activity size={18} className="text-primary" />
          </div>
          <div>
            <div className="text-2xl font-semibold font-mono">{summary.total_executions_30d}</div>
            <div className="text-xs text-muted-foreground">Executions (30d)</div>
          </div>
        </div>
        <div className="stat-tile flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center">
            <Timer size={18} className="text-success" />
          </div>
          <div>
            <div className="text-2xl font-semibold font-mono">{summary.active_cron_jobs}</div>
            <div className="text-xs text-muted-foreground">Scheduled Jobs</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily Schedule */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="section-title flex items-center gap-2">
              <Calendar size={14} /> Daily Schedule
            </h3>
          </div>
          <div className="panel-body">
            <div className="relative space-y-0">
              {schedule.map((job, i) => (
                <div
                  key={job.id}
                  className={`flex items-center gap-3 py-2.5 px-3 border-l-2 ${(agentStyles[job.agent] ?? fallbackStyle).borderClass} ${
                    i < schedule.length - 1 ? 'border-b border-border/30' : ''
                  }`}
                >
                  <span className="text-xs font-mono w-16 shrink-0 text-muted-foreground">
                    {job.schedule}
                  </span>
                  <span className="text-sm">{job.agentEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{job.label}</span>
                    {job.days && (
                      <span className="ml-2 text-[9px] bg-muted px-1.5 py-0.5 rounded uppercase text-muted-foreground">
                        {job.days.join(', ')}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{job.skill}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30 text-[10px] text-muted-foreground">
              {orderedAgentIds.map((agent) => {
                const style = agentStyles[agent] ?? fallbackStyle;
                const meta = knownAgents.get(agent);
                const label = meta?.name || toTitleFromId(agent);
                return (
                  <span key={agent} className="flex items-center gap-1">
                    <span className={`w-3 h-0.5 rounded ${style.dotClass}`} />
                    {meta?.emoji && <span>{meta.emoji}</span>}
                    {label}
                  </span>
                );
              })}
              <span>Weekdays only (Mon-Fri)</span>
            </div>
          </div>
        </div>

        {/* Approval Queue */}
        <div className="panel">
          <div className="panel-header flex items-center justify-between">
            <h3 className="section-title flex items-center gap-2">
              <CheckCircle size={14} /> Automation Approvals
              {approvals.length > 0 && (
                <span className="text-[10px] bg-warning/15 text-warning px-2 py-0.5 rounded-full font-semibold">
                  {approvals.length}
                </span>
              )}
            </h3>
            <Link href="/content" className="text-[10px] text-primary hover:underline">
              Content queue
            </Link>
          </div>
          <div className="panel-body">
            {approvals.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                <CheckCircle size={16} className="mr-2 text-success" /> All caught up
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {approvals.map(item => (
                  <ApprovalCardComponent
                    key={item.id}
                    item={item}
                    onAction={refetch}
                    canEdit={canEdit}
                    bgClass={(agentStyles[item.agent] ?? fallbackStyle).bgClass}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Skill Execution Stats */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="section-title flex items-center gap-2">
              <Zap size={14} /> Skill Executions (30 days)
            </h3>
          </div>
          <div className="panel-body">
            {skill_executions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No execution data yet</p>
            ) : (
              <div className="space-y-2">
                {skill_executions.map((exec, execIndex) => {
                  const maxCount = Math.max(...skill_executions.map(e => e.count), 1);
                  const width = (exec.count / maxCount) * 100;
                  const style = agentStyles[exec.agent] ?? fallbackStyle;
                  return (
                    <div key={`${exec.agent}-${exec.skill}-${execIndex}`} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dotClass}`} />
                          <span className="font-medium">{exec.skill}</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span className="font-mono">{exec.count}</span>
                          {exec.last_run && <span>{timeAgo(exec.last_run)}</span>}
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${style.barClass}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Today's Activity by Hour */}
        <div className="panel">
          <div className="panel-header">
            <h3 className="section-title flex items-center gap-2">
              <Clock size={14} /> Today&apos;s Activity by Hour
            </h3>
          </div>
          <div className="panel-body">
            <div className="flex items-end gap-[3px] h-32">
              {Array.from({ length: 24 }, (_, hour) => {
                const entry = hourly_activity.find(h => h.hour === hour);
                const count = entry?.c ?? 0;
                const maxCount = Math.max(...hourly_activity.map(h => h.c), 1);
                const height = count > 0 ? Math.max((count / maxCount) * 100, 8) : 2;
                const now = new Date().getHours();
                return (
                  <div
                    key={hour}
                    className="flex-1 flex flex-col items-center justify-end gap-1 group"
                    title={`${hour}:00 \u2014 ${count} actions`}
                  >
                    {count > 0 && (
                      <span className="text-[8px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        {count}
                      </span>
                    )}
                    <div
                      className={`w-full rounded-t transition-all ${
                        hour === now ? 'bg-primary' :
                        count > 0 ? 'bg-primary/30' : 'bg-muted/30'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground mt-1 px-1">
              <span>12am</span>
              <span>6am</span>
              <span>12pm</span>
              <span>6pm</span>
              <span>12am</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalCardComponent({
  item,
  onAction,
  canEdit,
  bgClass,
}: {
  item: ApprovalItem;
  onAction: () => void;
  canEdit: boolean;
  bgClass: string;
}) {
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);

  async function handleAction(action: 'approve' | 'reject') {
    if (!canEdit) return;
    setActing(action);
    await fetch('/api/automations/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, type: item.type, action }),
    });
    onAction();
    setActing(null);
  }

  return (
    <div className={`p-3 rounded-lg ${bgClass} flex items-start gap-3`}>
      <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
        {item.type === 'content' ? <PenLine size={14} /> : <Mail size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">{item.title}</span>
          {item.tier && (
            <span className="text-[9px] bg-muted px-1 rounded">Tier {item.tier}</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{item.preview}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <p className="text-[10px] text-muted-foreground flex-1">{timeAgo(item.created_at)}</p>
          {canEdit ? (
            <>
              <button
                onClick={() => handleAction('approve')}
                disabled={acting !== null}
                className="flex items-center gap-1 text-[10px] font-medium bg-success/15 text-success hover:bg-success/25 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
              >
                {acting === 'approve' ? <Loader2 size={10} className="animate-spin" /> : <ThumbsUp size={10} />}
                Approve
              </button>
              <button
                onClick={() => handleAction('reject')}
                disabled={acting !== null}
                className="flex items-center gap-1 text-[10px] font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
              >
                {acting === 'reject' ? <Loader2 size={10} className="animate-spin" /> : <ThumbsDown size={10} />}
                Reject
              </button>
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground">read-only</span>
          )}
        </div>
      </div>
    </div>
  );
}
