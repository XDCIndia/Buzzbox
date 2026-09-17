'use client';

import { useSmartPoll } from '@/hooks/use-smart-poll';
import { PageHeader } from '@/components/ui/page-header';

interface DeployStatusPayload {
  service: { name: string; state: string };
  deploy: {
    script_path: string;
    lock_file: string;
    lock_exists: boolean;
    running_pids: string[];
  };
  latest_log: {
    path: string;
    mtime: string;
    tail: string[];
  } | null;
}

export default function DeployPage() {
  const { data, loading } = useSmartPoll<DeployStatusPayload | null>(
    () => fetch('/api/deploy-status').then(async r => (r.ok ? r.json() : null)),
    { interval: 15_000, key: 'deploy-status' },
  );

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-in">
        <PageHeader
          index="14"
          eyebrow="System"
          title="Deploy"
          description="Service health, deploy state, and operations."
        />
        <div className="panel p-6 h-48 animate-pulse bg-muted/20" />
      </div>
    );
  }

  const serviceOk = data.service.state === 'active';
  const deployRunning = data.deploy.running_pids.length > 0;

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="14"
        eyebrow="System"
        title="Deploy"
        description="Service health, deploy state, and operations."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatusCard label="Service" value={data.service.state} ok={serviceOk} />
        <StatusCard label="Deploy Lock" value={data.deploy.lock_exists ? 'present' : 'none'} ok={!data.deploy.lock_exists || deployRunning} />
        <StatusCard label="Deploy Process" value={deployRunning ? 'running' : 'idle'} ok />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="section-title">Deploy Runtime</h2>
        </div>
        <div className="panel-body space-y-2 text-xs">
          <div><span className="text-muted-foreground">Script:</span> <code>{data.deploy.script_path}</code></div>
          <div><span className="text-muted-foreground">Lock:</span> <code>{data.deploy.lock_file}</code></div>
          {data.deploy.running_pids.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1">Running PIDs</div>
              <div className="space-y-1">
                {data.deploy.running_pids.map((p, i) => (
                  <code key={`${i}-${p}`} className="block bg-muted/30 rounded px-2 py-1">{p}</code>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header flex items-center justify-between mb-2">
          <div className="section-title">Latest Deploy Log</div>
          <div className="text-xs text-muted-foreground">{data.latest_log?.mtime ?? 'No log yet'}</div>
        </div>
        <div className="panel-body">
          {!data.latest_log ? (
            <div className="text-sm text-muted-foreground">No deploy log found yet.</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-2"><code>{data.latest_log.path}</code></div>
              <pre className="text-xs bg-muted/20 rounded p-3 max-h-[420px] overflow-auto whitespace-pre-wrap">
                {data.latest_log.tail.join('\n')}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="stat-tile">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold font-mono ${ok ? 'text-success' : 'text-warning'}`}>{value}</div>
    </div>
  );
}
