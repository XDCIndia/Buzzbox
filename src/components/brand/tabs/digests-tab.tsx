'use client';

import { useEffect, useState } from 'react';
import { Sparkles, FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { BrandDigest } from '@/types';

export function DigestsTab({ brandId }: { brandId: string }) {
  const [digests, setDigests] = useState<BrandDigest[]>([]);
  const [active, setActive] = useState<BrandDigest | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch(`/api/brand/${brandId}/digests`).then(r => r.json()).then((data: BrandDigest[]) => {
      setDigests(data);
      if (data.length) setActive(data[0]);
    }).catch(() => {});
  }, [brandId]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/brand/${brandId}/digests`, { method: 'POST' });
      const digest = await res.json();
      setDigests(prev => [digest, ...prev]);
      setActive(digest);
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
          <div className="panel-body flex flex-col items-center justify-center text-center py-16 space-y-2">
            <FileText size={32} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generate a digest to see an auto-written summary of recent mention activity.</p>
          </div>
        )}
      </section>
    </div>
  );
}
