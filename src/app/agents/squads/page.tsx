'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import {
  Cpu, Wrench, Zap, ChevronDown, ChevronUp,
  Circle, Activity,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { timeAgo } from '@/lib/utils';
import type { AgentRuntime, ActivityEntry, MemoryHealthPayload, MemoryDriftPayload } from '@/types';
import type { AgentDefinition, AgentSkill } from '@/lib/agent-config';

type AgentWithRuntime = AgentDefinition & AgentRuntime;

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success',
  idle: 'bg-warning',
  error: 'bg-destructive',
  planned: 'bg-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  idle: 'Idle',
  error: 'Error',
  planned: 'Not Started',
};

const CATEGORY_COLORS: Record<string, string> = {
  marketing: 'bg-primary/15 text-primary',
  sales: 'bg-success/15 text-success',
  research: 'bg-info/15 text-info',
  ops: 'bg-warning/15 text-warning',
};

export default function AgentsPage() {
  const realOnly = useDashboard(s => s.realOnly);
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((payload) => setRole(payload?.user?.role === 'admin' ? 'admin' : payload?.user?.role === 'editor' ? 'editor' : 'viewer'))
      .catch(() => setRole('viewer'));
  }, []);

  const { data: agents, loading } = useSmartPoll<AgentWithRuntime[]>(
    () => fetch(`/api/agents${realOnly ? '?real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );
  const { data: memoryHealth } = useSmartPoll<MemoryHealthPayload | null>(
    () => fetch('/api/memory-health').then(async r => (r.ok ? r.json() : null)),
    { interval: 60_000, key: 'memory-health' },
  );
  const { data: memoryDrift } = useSmartPoll<MemoryDriftPayload | null>(
    () => fetch('/api/memory-drift').then(async r => (r.ok ? r.json() : null)),
    { interval: 120_000, key: 'memory-drift' },
  );
  const lowCoverageAgents = (memoryHealth?.agents ?? [])
    .filter(a => (a.coverage_ratio ?? 0) < 0.8 && a.session_files > 0)
    .map(a => `${a.agent_id} (${(a.coverage_ratio ?? 0).toFixed(2)})`);
  const collectiveMtimeMs = memoryHealth?.collective.md_mtime ? Date.parse(memoryHealth.collective.md_mtime) : NaN;
  const collectedAtMs = memoryHealth?.collected_at ? Date.parse(memoryHealth.collected_at) : NaN;
  const collectiveStaleHours = Number.isNaN(collectiveMtimeMs)
    ? null
    : Math.max(0, ((Number.isNaN(collectedAtMs) ? collectiveMtimeMs : collectedAtMs) - collectiveMtimeMs) / (1000 * 60 * 60));
  const weakAgents = memoryDrift?.contributions.weak_agents ?? [];

  if (!agents || loading) {
    return (
      <div className="space-y-6 animate-in">
        <PageHeader
          index="17"
          eyebrow="Agents"
          title="Squads"
          description="Squads, runtime health, and operator comms."
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="panel p-6 h-64 animate-pulse bg-muted/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="17"
        eyebrow="Agents"
        title="Squads"
        description="Squads, runtime health, and operator comms."
      >
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap justify-end">
          <span className="flex items-center gap-1.5"><Circle size={8} className="fill-success text-success" /> Active</span>
          <span className="flex items-center gap-1.5"><Circle size={8} className="fill-warning text-warning" /> Idle</span>
          <span className="flex items-center gap-1.5"><Circle size={8} className="fill-muted-foreground text-muted-foreground" /> Planned</span>
          <span className="badge border bg-muted/20 text-muted-foreground">
            Role: {role}
          </span>
        </div>
      </PageHeader>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Agent Squads</h2>
          <p className="text-xs text-muted-foreground">Health, drift, and per-agent runtime details.</p>
        </div>

      {memoryHealth && (
        <div className="panel">
          <div className="panel-header">
            <div className="text-sm font-medium">Memory Health</div>
            <div className="text-xs text-muted-foreground">
              Updated {timeAgo(memoryHealth.collected_at)}
            </div>
          </div>
          <div className="panel-body">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">{memoryHealth.collective.entries}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Collective Entries</div>
            </div>
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">{memoryHealth.agents.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Tracked Agents</div>
            </div>
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">
                {
                  memoryHealth.agents.filter(a => (a.coverage_ratio ?? 0) >= 0.8).length
                }
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Coverage ≥ 0.8</div>
            </div>
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">
                {
                  memoryHealth.agents.reduce((sum, a) => sum + a.session_files, 0)
                }
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Session Files</div>
            </div>
            </div>
          </div>
          {(lowCoverageAgents.length > 0 || (collectiveStaleHours !== null && collectiveStaleHours > 6)) && (
            <div className="px-4 pb-4 space-y-1.5 text-xs">
              {collectiveStaleHours !== null && collectiveStaleHours > 6 && (
                <div className="text-warning">
                  Collective memory is stale: {collectiveStaleHours.toFixed(1)}h since last update.
                </div>
              )}
              {lowCoverageAgents.length > 0 && (
                <div className="text-warning">
                  Low memory coverage (&lt; 0.80): {lowCoverageAgents.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {memoryDrift && (
        <div className="panel">
          <div className="panel-header">
            <div className="text-sm font-medium">Memory Drift (7d)</div>
            <div className="flex items-center gap-3">
              <Link href="/memory" className="text-xs text-primary hover:underline">
                Open full drift view
              </Link>
              <div className="text-xs text-muted-foreground">
                Updated {timeAgo(memoryDrift.collected_at)}
              </div>
            </div>
          </div>
          <div className="panel-body">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">{memoryDrift.contradictions.count}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Contradictions</div>
            </div>
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">{memoryDrift.duplicates.count}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Duplicate Clusters</div>
            </div>
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">{weakAgents.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Weak Contributors</div>
            </div>
            <div className="stat-tile text-center">
              <div className="text-lg font-semibold font-mono">{memoryDrift.collective_total}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Collective Entries</div>
            </div>
            </div>
          </div>
          <div className="px-4 pb-1 text-xs text-muted-foreground">
            Access temperature: hot {memoryDrift.access.hot_count} · cold {memoryDrift.access.cold_count} · never {memoryDrift.access.never_accessed_count}
          </div>
          {(memoryDrift.contradictions.count > 0 || memoryDrift.duplicates.count > 0 || weakAgents.length > 0) && (
            <div className="px-4 pb-4 space-y-1.5 text-xs">
              {memoryDrift.contradictions.count > 0 && (
                <div className="text-warning">
                  Contradictions detected in last {memoryDrift.window_days}d: {memoryDrift.contradictions.count}
                </div>
              )}
              {memoryDrift.duplicates.count > 0 && (
                <div className="text-warning">
                  Duplicate memory clusters: {memoryDrift.duplicates.count}
                </div>
              )}
              {weakAgents.length > 0 && (
                <div className="text-warning">
                  Weak contributors: {weakAgents.slice(0, 4).map(a => a.agent_id).join(', ')}
                  {weakAgents.length > 4 ? ` +${weakAgents.length - 4}` : ''}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map(agent => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
      </section>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentWithRuntime }) {
  const [expanded, setExpanded] = useState(false);
  const fmtCost = (n: number) => `$${n.toFixed(3)}`;

  return (
    <div className="panel card-hover">
      {/* Header */}
      <div className="panel-body space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg">
              {agent.emoji}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{agent.name}</h3>
                <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[agent.status]}`} />
                <span className="text-xs text-muted-foreground">{STATUS_LABELS[agent.status]}</span>
              </div>
              <p className="text-xs text-muted-foreground">{agent.role}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cpu size={12} />
            <span>{agent.model}</span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{agent.description}</p>
        {agent.fallbacks.length > 0 && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Fallbacks</div>
            <div className="flex flex-wrap gap-1">
              {agent.fallbacks.slice(0, 4).map(f => (
                <code key={f} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
                  {f}
                </code>
              ))}
              {agent.fallbacks.length > 4 && (
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5">
                  +{agent.fallbacks.length - 4} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-5 gap-3">
          <div className="stat-tile text-center">
            <div className="text-lg font-semibold font-mono">{agent.stats.actions_today}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Today</div>
          </div>
          <div className="stat-tile text-center">
            <div className="text-lg font-semibold font-mono">{agent.stats.actions_week}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">This Week</div>
          </div>
          <div className="stat-tile text-center">
            <div className="text-lg font-semibold font-mono">{agent.skills.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Skills</div>
          </div>
          <div className="stat-tile text-center">
            <div className="text-lg font-semibold font-mono">{agent.stats.tokens_today}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Tokens Today</div>
          </div>
          <div className="stat-tile text-center">
            <div className="text-lg font-semibold font-mono">{fmtCost(agent.stats.cost_week)}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Cost (7d)</div>
          </div>
        </div>

        {/* Skills Tags */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <Zap size={12} />
            <span className="font-medium">Skills</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agent.skills.map(skill => (
              <span
                key={skill.id}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[skill.category]}`}
              >
                {skill.name}
              </span>
            ))}
          </div>
        </div>

        {/* Last Activity */}
        {agent.stats.last_action_at && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity size={12} />
            <span className="truncate">{agent.stats.last_action}</span>
            <span className="shrink-0">{timeAgo(agent.stats.last_action_at)}</span>
          </div>
        )}
      </div>

      {/* Expand Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:bg-muted/30 border-t border-border/50 transition-colors"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Less' : 'Details'}
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-border/30 animate-in">
          {/* Skill Details */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <Zap size={12} />
              <span className="font-medium">Skill Details</span>
            </div>
            <div className="space-y-2">
              {agent.skills.map((skill: AgentSkill) => (
                <div key={skill.id} className="text-xs">
                  <span className="font-medium">{skill.name}</span>
                  <p className="text-muted-foreground mt-0.5">{skill.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tools */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <Wrench size={12} />
              <span className="font-medium">Tools ({agent.tools.length})</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {agent.tools.map(tool => (
                <code key={tool} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
                  {tool}
                </code>
              ))}
            </div>
          </div>

          {/* Model Routing */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <Cpu size={12} />
              <span className="font-medium">Model Routing</span>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-14">Primary</span>
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{agent.model}</code>
              </div>
              {agent.fallbacks.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground w-14 mt-0.5">Fallbacks</span>
                  <div className="flex flex-wrap gap-1">
                    {agent.fallbacks.map(f => (
                      <code key={f} className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                        {f}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-muted-foreground">
                Tokens today: <span className="font-mono">{agent.stats.tokens_today}</span>
                {' · '}
                Tokens (7d): <span className="font-mono">{agent.stats.tokens_week}</span>
                {' · '}
                Cost today: <span className="font-mono">{fmtCost(agent.stats.cost_today)}</span>
                {' · '}
                Cost (7d): <span className="font-mono">{fmtCost(agent.stats.cost_week)}</span>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          {agent.recent_activity.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Activity size={12} />
                <span className="font-medium">Recent Activity</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {agent.recent_activity.map((entry: ActivityEntry) => (
                  <div key={entry.id} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 w-16 font-mono">
                      {entry.ts ? timeAgo(entry.ts) : ''}
                    </span>
                    <span className="truncate">{entry.detail}</span>
                    {entry.result && (
                      <span className="text-success shrink-0">{entry.result}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
