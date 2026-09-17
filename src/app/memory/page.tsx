'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AlertTriangle, BrainCircuit, GitCompare, RefreshCcw, Users } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';
import type { MemoryAlertsPayload, MemoryDriftPayload, MemoryHealthPayload } from '@/types';

type HermesInstance = { id: string; label: string };
type InstancesResponse = { default_instance: string; instances: HermesInstance[] };

type MemoryEffectPayload = {
  instance: string;
  available: boolean;
  reason?: string;
  history_points?: number;
  policy_changes?: number;
  latest_policy_change?: string;
  baseline_at?: string;
  current_at?: string;
  deltas?: {
    contradictions: { before: number; after: number; delta: number };
    duplicates: { before: number; after: number; delta: number };
    weak_agents: { before: number; after: number; delta: number };
    hot_memory: { before: number; after: number; delta: number };
    never_accessed_ratio: { before: number; after: number; delta: number };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return payload as T;
}

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return String(Math.trunc(Number(n)));
}

function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function severityClass(sev: string | undefined): string {
  if (sev === 'error') return 'text-destructive';
  if (sev === 'warning') return 'text-warning';
  return 'text-muted-foreground';
}

export default function MemoryPage() {
  const [instances, setInstances] = useState<HermesInstance[]>([]);
  const [instanceId, setInstanceId] = useState('');
  const [instancesError, setInstancesError] = useState<string | null>(null);

  const [accessQuery, setAccessQuery] = useState('');
  const [showAllAccess, setShowAllAccess] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchJson<InstancesResponse>('/api/instances')
      .then((payload) => {
        if (!alive) return;
        const next = Array.isArray(payload.instances) ? payload.instances : [];
        setInstances(next);
        setInstanceId((prev) => prev || payload.default_instance || next[0]?.id || 'default');
        setInstancesError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setInstancesError(e instanceof Error ? e.message : String(e));
        setInstanceId((prev) => prev || 'default');
      });
    return () => {
      alive = false;
    };
  }, []);

  const enabled = !!instanceId;
  const qs = useMemo(() => `?instance=${encodeURIComponent(instanceId)}`, [instanceId]);

  const drift = useSmartPoll<MemoryDriftPayload>(
    () => fetchJson<MemoryDriftPayload>(`/api/memory-drift${qs}`),
    { interval: 120_000, enabled, key: `memory-drift:${instanceId}` },
  );

  const health = useSmartPoll<MemoryHealthPayload>(
    () => fetchJson<MemoryHealthPayload>(`/api/memory-health${qs}`),
    { interval: 60_000, enabled, key: `memory-health:${instanceId}` },
  );

  const alerts = useSmartPoll<MemoryAlertsPayload>(
    () => fetchJson<MemoryAlertsPayload>(`/api/memory-alerts${qs}`),
    { interval: 60_000, enabled, key: `memory-alerts:${instanceId}` },
  );

  const effect = useSmartPoll<MemoryEffectPayload>(
    () => fetchJson<MemoryEffectPayload>(`/api/memory-effect${qs}`),
    { interval: 120_000, enabled, key: `memory-effect:${instanceId}` },
  );

  const doRefresh = useCallback(() => {
    drift.refetch();
    health.refetch();
    alerts.refetch();
    effect.refetch();
  }, [drift, health, alerts, effect]);

  const weakAgents = drift.data?.contributions.weak_agents ?? [];
  const neverRatioPct = drift.data?.access.total
    ? Math.round((drift.data.access.never_accessed_count / drift.data.access.total) * 100)
    : 0;

  const contradictionAgents = useMemo(() => {
    const entries = Object.entries(drift.data?.contradictions.by_agent ?? {});
    return entries.sort((a, b) => b[1] - a[1]);
  }, [drift.data]);

  const accessRows = useMemo(() => {
    const rows = drift.data?.access.top_accessed ?? [];
    const q = accessQuery.trim().toLowerCase();
    return rows
      .filter((r) => (showAllAccess ? true : r.access_count > 0))
      .filter((r) => {
        if (!q) return true;
        const v = String(r.value ?? '').toLowerCase();
        const t = String(r.type ?? '').toLowerCase();
        const id = String(r.id ?? '').toLowerCase();
        return v.includes(q) || t.includes(q) || id.includes(q);
      });
  }, [drift.data, accessQuery, showAllAccess]);

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="13"
        eyebrow="System"
        title="Memory"
        description="Drift, health, and recall risk signals."
      >
        <Link className="text-xs text-primary hover:underline" href="/settings">Tune policies</Link>
        <div className="flex items-center gap-2">
          <select
            className="px-2 py-1 rounded-md border border-border bg-background text-xs"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            disabled={instances.length === 0 && !instanceId}
          >
            {instances.length === 0 ? (
              <option value={instanceId || 'default'}>{instanceId || 'Loading...'}</option>
            ) : (
              instances.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label} ({it.id})
                </option>
              ))
            )}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={doRefresh}>
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </PageHeader>

      {instancesError && (
        <div className="panel p-4 text-xs text-warning">
          Failed to load instances: {instancesError}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2 className="section-title flex items-center gap-2">
            <AlertTriangle size={14} className="text-warning" /> Memory Alerts
          </h2>
          <div className="text-xs text-muted-foreground">
            {alerts.data
              ? `Thresholds: c≥${alerts.data.thresholds.contradictions}, d≥${alerts.data.thresholds.duplicates}, w≥${alerts.data.thresholds.weak_agents}, never≥${Math.round(alerts.data.thresholds.never_ratio * 100)}%`
              : ''}
          </div>
        </div>
        <div className="panel-body">
          {alerts.loading ? (
            <div className="text-sm text-muted-foreground">Loading alerts...</div>
          ) : alerts.error ? (
            <div className="text-sm text-warning">{alerts.error.message}</div>
          ) : !alerts.data ? (
            <div className="text-sm text-muted-foreground">No alert data.</div>
          ) : alerts.data.active.length === 0 ? (
            <div className="text-sm text-muted-foreground">No active alerts.</div>
          ) : (
            <div className="space-y-2">
              {alerts.data.active.map((a) => (
                <div key={a.key} className="rounded-lg border border-border/40 p-3 bg-muted/10">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium">{a.title}</div>
                    <div className={`text-[10px] uppercase tracking-wide ${severityClass(a.severity)}`}>{a.severity}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{a.message}</div>
                  {a.data && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">Details</summary>
                      <pre className="mt-2 text-[11px] overflow-auto bg-muted/30 p-2 rounded">{JSON.stringify(a.data, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="panel">
          <div className="panel-header">
            <h2 className="section-title flex items-center gap-2">
              <Users size={14} className="text-info" /> Memory Health
            </h2>
            <div className="text-xs text-muted-foreground">
              {health.data ? `Updated ${timeAgo(health.data.collected_at)}` : ''}
            </div>
          </div>
          <div className="panel-body space-y-3">
            {health.loading ? (
              <div className="text-sm text-muted-foreground">Loading memory health...</div>
            ) : health.error ? (
              <div className="text-sm text-warning">{health.error.message}</div>
            ) : !health.data ? (
              <div className="text-sm text-muted-foreground">No health report.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="stat-tile text-center">
                    <div className="text-lg font-semibold font-mono">{fmtInt(health.data.collective.entries)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Collective Entries</div>
                  </div>
                  <div className="stat-tile text-center">
                    <div className="text-lg font-semibold font-mono">{fmtInt(health.data.agents.length)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Agents</div>
                  </div>
                  <div className="stat-tile text-center">
                    <div className="text-lg font-semibold font-mono">{fmtInt(health.data.agents.filter(a => a.memory_db_exists).length)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">DB Present</div>
                  </div>
                  <div className="stat-tile text-center">
                    <div className="text-lg font-semibold font-mono">{fmtInt(health.data.agents.reduce((sum, a) => sum + a.memory_chunks, 0))}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Chunks</div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/40 p-3 bg-muted/10 text-xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium">Collective</div>
                    <div className="text-muted-foreground font-mono text-[10px]">{health.data.collective.shared_dir}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div>md: {health.data.collective.md_exists ? 'yes' : 'no'} · {health.data.collective.md_mtime ? timeAgo(health.data.collective.md_mtime) : '—'}</div>
                    <div>jsonl: {health.data.collective.jsonl_exists ? 'yes' : 'no'} · {health.data.collective.jsonl_mtime ? timeAgo(health.data.collective.jsonl_mtime) : '—'}</div>
                  </div>
                </div>

                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/40">
                        <th className="text-left py-2">Agent</th>
                        <th className="text-left py-2">Sessions</th>
                        <th className="text-left py-2">Indexed</th>
                        <th className="text-left py-2">Chunks</th>
                        <th className="text-left py-2">Coverage</th>
                        <th className="text-left py-2">Last Session</th>
                        <th className="text-left py-2">Last Indexed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.data.agents.map((a) => {
                        const cov = a.coverage_ratio;
                        const covWarn = cov !== null && cov !== undefined && a.session_files > 0 && cov < 0.8;
                        return (
                          <tr key={a.agent_id} className="border-b border-border/20 align-top">
                            <td className="py-2 pr-2 font-mono">{a.agent_id}</td>
                            <td className="py-2 pr-2 font-mono">{a.session_files}</td>
                            <td className="py-2 pr-2 font-mono">{a.memory_files_indexed}</td>
                            <td className="py-2 pr-2 font-mono">{a.memory_chunks}</td>
                            <td className={`py-2 pr-2 font-mono ${covWarn ? 'text-warning' : ''}`}>{fmtRatio(cov)}</td>
                            <td className="py-2 pr-2">{a.last_session_at ? timeAgo(a.last_session_at) : '—'}</td>
                            <td className="py-2">{a.last_indexed_at ? timeAgo(a.last_indexed_at) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="section-title flex items-center gap-2">
              <BrainCircuit size={14} className="text-primary" /> Policy Effect
            </h2>
            <div className="text-xs text-muted-foreground">Recent drift change vs latest policy change</div>
          </div>
          <div className="panel-body">
            {effect.loading ? (
              <div className="text-sm text-muted-foreground">Loading policy effect...</div>
            ) : effect.error ? (
              <div className="text-sm text-warning">{effect.error.message}</div>
            ) : !effect.data ? (
              <div className="text-sm text-muted-foreground">No policy effect data.</div>
            ) : !effect.data.available || !effect.data.deltas ? (
              <div className="text-sm text-muted-foreground">
                Not enough history yet ({effect.data.history_points ?? 0} drift points, {effect.data.policy_changes ?? 0} policy changes).
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-3">
                  Baseline: {effect.data.baseline_at} · Current: {effect.data.current_at}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <MetricDelta label="Contradictions" value={effect.data.deltas.contradictions} inverse />
                  <MetricDelta label="Duplicates" value={effect.data.deltas.duplicates} inverse />
                  <MetricDelta label="Weak Agents" value={effect.data.deltas.weak_agents} inverse />
                  <MetricDelta label="Hot Memory" value={effect.data.deltas.hot_memory} />
                  <MetricDelta label="Never Accessed Ratio" value={effect.data.deltas.never_accessed_ratio} percent inverse />
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2 className="section-title flex items-center gap-2">
            <GitCompare size={14} className="text-primary" /> Memory Drift
          </h2>
          <div className="text-xs text-muted-foreground">
            {drift.data ? `Updated ${timeAgo(drift.data.collected_at)} · Window ${drift.data.window_days}d` : ''}
          </div>
        </div>

        <div className="panel-body space-y-4">
          {drift.loading ? (
            <div className="text-sm text-muted-foreground">Loading memory drift...</div>
          ) : drift.error ? (
            <div className="text-sm text-warning">{drift.error.message}</div>
          ) : !drift.data ? (
            <div className="text-sm text-muted-foreground">No drift report.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Contradictions" value={drift.data.contradictions.count} icon={<AlertTriangle size={14} />} />
                <StatCard label="Duplicate Clusters" value={drift.data.duplicates.count} icon={<GitCompare size={14} />} />
                <StatCard label="Weak Contributors" value={weakAgents.length} icon={<Users size={14} />} />
                <StatCard label="Collective Entries" value={drift.data.collective_total} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Hot Memory" value={drift.data.access.hot_count} />
                <StatCard label="Cold Memory" value={drift.data.access.cold_count} />
                <StatCard label="Never Accessed" value={drift.data.access.never_accessed_count} />
                <StatCard label="Never Ratio" value={neverRatioPct} suffix="%" />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <section className="rounded-lg border border-border/40">
                  <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Top Contradictions</div>
                    <div className="text-xs text-muted-foreground">{drift.data.contradictions.top_events.length}</div>
                  </div>
                  <div className="p-4">
                    {drift.data.contradictions.top_events.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No contradiction events in this window.</div>
                    ) : (
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/40">
                              <th className="text-left py-2">Time</th>
                              <th className="text-left py-2">Action</th>
                              <th className="text-left py-2">Reason</th>
                              <th className="text-left py-2">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drift.data.contradictions.top_events.slice(0, 15).map((ev, idx) => (
                              <tr key={`${ev.timestamp}-${idx}`} className="border-b border-border/20 align-top">
                                <td className="py-2 pr-2 whitespace-nowrap">{timeAgo(ev.timestamp)}</td>
                                <td className="py-2 pr-2 font-mono">{ev.action}</td>
                                <td className="py-2 pr-2">{ev.reason}</td>
                                <td className="py-2"><LongText value={String(ev.value || ev.new_value || '-')} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-border/40">
                  <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Duplicate Clusters</div>
                    <div className="text-xs text-muted-foreground">{drift.data.duplicates.top_clusters.length}</div>
                  </div>
                  <div className="p-4">
                    {drift.data.duplicates.top_clusters.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No duplicate clusters detected.</div>
                    ) : (
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/40">
                              <th className="text-left py-2">Type</th>
                              <th className="text-left py-2">Size</th>
                              <th className="text-left py-2">Signature</th>
                              <th className="text-left py-2">Variants</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drift.data.duplicates.top_clusters.slice(0, 15).map((d, idx) => (
                              <tr key={`${d.type}-${d.signature}-${idx}`} className="border-b border-border/20 align-top">
                                <td className="py-2 pr-2 font-mono">{d.type}</td>
                                <td className="py-2 pr-2 font-mono">{d.size}</td>
                                <td className="py-2 pr-2"><LongText value={d.signature} /></td>
                                <td className="py-2"><LongText value={d.variants.slice(0, 3).join(' | ')} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <section className="rounded-lg border border-border/40">
                  <div className="px-4 py-3 border-b border-border/30">
                    <div className="text-sm font-medium">Weak Contributors</div>
                  </div>
                  <div className="p-4">
                    {drift.data.contributions.weak_agents.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No weak contributors under current threshold.</div>
                    ) : (
                      <div className="overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/40">
                              <th className="text-left py-2">Agent</th>
                              <th className="text-left py-2">Sessions</th>
                              <th className="text-left py-2">Entries</th>
                              <th className="text-left py-2">Ratio</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drift.data.contributions.weak_agents.map(a => (
                              <tr key={a.agent_id} className="border-b border-border/20">
                                <td className="py-2 pr-2">{a.agent_id}</td>
                                <td className="py-2 pr-2 font-mono">{a.session_files}</td>
                                <td className="py-2 pr-2 font-mono">{a.contributed_entries}</td>
                                <td className="py-2 font-mono">{a.contribution_ratio === null ? '-' : a.contribution_ratio.toFixed(3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-border/40">
                  <div className="px-4 py-3 border-b border-border/30">
                    <div className="text-sm font-medium">Contradictions By Agent</div>
                  </div>
                  <div className="p-4">
                    {contradictionAgents.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No contradiction producers in this window.</div>
                    ) : (
                      <div className="space-y-2">
                        {contradictionAgents.slice(0, 15).map(([agent, count]) => (
                          <div key={agent} className="flex items-center justify-between text-xs">
                            <span>{agent}</span>
                            <span className="font-mono">{count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-lg border border-border/40">
                <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-medium">Accessed Memory</div>
                  <div className="flex items-center gap-2">
                    <input
                      value={accessQuery}
                      onChange={(e) => setAccessQuery(e.target.value)}
                      placeholder="Filter (id/type/value)…"
                      className="bg-muted/30 border border-border rounded px-3 py-1.5 text-xs w-56"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                      <input
                        type="checkbox"
                        checked={showAllAccess}
                        onChange={(e) => setShowAllAccess(e.target.checked)}
                      />
                      Show all
                    </label>
                  </div>
                </div>

                <div className="p-4">
                  {accessRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      {showAllAccess ? 'No rows match your filter.' : 'No accessed memory yet (all access_count=0). Toggle “Show all” to inspect.'}
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border/40">
                            <th className="text-left py-2">Type</th>
                            <th className="text-left py-2">Access</th>
                            <th className="text-left py-2">Last</th>
                            <th className="text-left py-2">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accessRows.slice(0, 50).map((row, idx) => (
                            <tr key={`${row.id ?? row.value ?? 'row'}-${idx}`} className="border-b border-border/20 align-top">
                              <td className="py-2 pr-2 font-mono">{row.type ?? '-'}</td>
                              <td className="py-2 pr-2 font-mono">{row.access_count}</td>
                              <td className="py-2 pr-2">{row.last_accessed ? timeAgo(row.last_accessed) : '-'}</td>
                              <td className="py-2"><LongText value={String(row.value ?? '-')} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {accessRows.length > 50 && (
                        <div className="text-[11px] text-muted-foreground mt-2">Showing first 50 rows.</div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function LongText({ value }: { value: string }) {
  const v = value || '';
  const short = v.length > 140 ? `${v.slice(0, 140)}...` : v;
  if (v.length <= 140) return <span className="whitespace-pre-wrap">{v}</span>;
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground whitespace-pre-wrap">{short}</summary>
      <div className="mt-2 whitespace-pre-wrap">{v}</div>
    </details>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="stat-tile">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground uppercase tracking-wide">
        <span>{label}</span>
        {icon}
      </div>
      <div className="text-xl font-semibold font-mono mt-1">{value}{suffix ?? ''}</div>
    </div>
  );
}

function MetricDelta({
  label,
  value,
  percent = false,
  inverse = false,
}: {
  label: string;
  value: { before: number; after: number; delta: number };
  percent?: boolean;
  inverse?: boolean;
}) {
  const good = inverse ? value.delta <= 0 : value.delta >= 0;
  const cls = good ? 'text-success' : 'text-warning';
  const fmt = (n: number) => (percent ? `${(n * 100).toFixed(1)}%` : `${n}`);
  const deltaPrefix = value.delta > 0 ? '+' : '';
  return (
    <div className="bg-muted/30 rounded p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono">
        {fmt(value.before)} → {fmt(value.after)}{' '}
        <span className={cls}>({deltaPrefix}{fmt(value.delta)})</span>
      </div>
    </div>
  );
}
