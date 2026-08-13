'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Bell, RadioTower } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { EmptyState } from '@/components/brand/empty-state';
import type { BrandAlert } from '@/types';

export function AlertsTab({ brandId }: { brandId: string }) {
  const [alerts, setAlerts] = useState<BrandAlert[]>([]);
  const [name, setName] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [checking, setChecking] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  function load() {
    fetch(`/api/brand/${brandId}/alerts`).then(r => r.json()).then(setAlerts).catch(() => {});
  }
  useEffect(load, [brandId]);

  async function createAlert(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`/api/brand/${brandId}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), filters: sentiment ? { sentiment } : {} }),
    });
    setName('');
    setSentiment('');
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/brand/${brandId}/alerts/${id}`, { method: 'DELETE' });
    load();
  }

  async function checkNow(id: string) {
    setChecking(id);
    try {
      const res = await fetch(`/api/brand/${brandId}/alerts/${id}/check`, { method: 'POST' });
      const data = await res.json();
      setResult(prev => ({ ...prev, [id]: `${data.matched} match${data.matched === 1 ? '' : 'es'} — check the notification bell.` }));
      load();
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="panel-header"><h2 className="section-title">New Alert</h2></div>
        <div className="panel-body">
          <form onSubmit={createAlert} className="flex flex-wrap gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Alert name (e.g. Negative Sentiment)" className="flex-1 min-w-[200px]" />
            <select value={sentiment} onChange={e => setSentiment(e.target.value)}>
              <option value="">Any sentiment</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <button type="submit" className="brand-btn-primary btn btn-sm"><Plus size={13} /> New Alert</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">{alerts.length} Alert{alerts.length === 1 ? '' : 's'}</h2></div>
        <div className="panel-body space-y-2">
          {alerts.length === 0 ? (
            <EmptyState icon={Bell} description="No alerts configured yet." />
          ) : alerts.map(a => (
            <div key={a.id} className="brand-stat-tile space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => checkNow(a.id)} disabled={checking === a.id} className="btn btn-ghost btn-sm">
                    <RadioTower size={12} /> {checking === a.id ? 'Checking…' : 'Check now'}
                  </button>
                  <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Filter: {a.filters.sentiment || 'any sentiment'} · last checked {a.last_checked_at ? formatDateTime(a.last_checked_at) : 'never'}
              </div>
              {result[a.id] && <div className="text-xs" style={{ color: 'var(--brand-coral)' }}>{result[a.id]}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
