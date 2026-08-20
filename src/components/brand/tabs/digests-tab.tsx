'use client';

import { useEffect, useState } from 'react';
import { Sparkles, FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { EmptyState } from '@/components/brand/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import type { BrandDigest } from '@/types';

export function DigestsTab({ brandId }: { brandId: string }) {
  const [digests, setDigests] = useState<BrandDigest[]>([]);
  const [active, setActive] = useState<BrandDigest | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadDigests() {
    setError(null);
    fetch(`/api/brand/${brandId}/digests`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch digests');
        return r.json();
      })
      .then((data: BrandDigest[]) => {
        setDigests(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length) setActive(data[0]);
      })
      .catch(err => setError((err as Error).message));
  }

  useEffect(() => {
    loadDigests();
  }, [brandId]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${brandId}/digests`, { method: 'POST' });
      const digest = await res.json();
      setDigests(prev => [digest, ...prev]);
      setActive(digest);
    } catch {
      setError('Failed to generate new digest');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <section className="panel">
        <div className="panel-header">
          <h2 className="section-title">Digests</h2>
          <button onClick={generate} disabled={generating} className="brand-btn-primary btn btn-sm">
            <Sparkles size={13} /> {generating ? 'Generating…' : 'New'}
          </button>
        </div>
        <div className="panel-body space-y-1">
          {error && <ErrorBanner message={error} variant="inline" onRetry={loadDigests} />}
          {digests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No digests yet</p>
          ) : digests.map(d => (
            <button key={d.id} onClick={() => setActive(d)} className={`brand-nav-item w-full text-left flex-col items-start ${active?.id === d.id ? 'active' : ''}`}>
              <span className="font-medium truncate w-full">{d.title}</span>
              <span className="text-xs text-muted-foreground">{formatDate(d.period_start)} – {formatDate(d.period_end)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        {active ? (
          <div className="panel-body space-y-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Auto-generated summary — not AI-written</div>
            <h1 className="text-xl font-semibold">{active.title}</h1>
            <p className="text-sm text-muted-foreground">{formatDate(active.created_at)}</p>
            <div className="whitespace-pre-line text-sm leading-relaxed pt-2">{active.body}</div>
          </div>
        ) : (
          <div className="panel-body">
            <EmptyState
              icon={FileText}
              title="No digests generated"
              description="Generate a digest to see an auto-written summary of recent mention activity."
              primaryAction={{
                label: generating ? 'Generating…' : 'Generate First Digest',
                onClick: generate,
                icon: Sparkles,
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
