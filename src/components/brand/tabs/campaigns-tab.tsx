'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Megaphone } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { BrandCampaign } from '@/types';

export function CampaignsTab({ brandId }: { brandId: string }) {
  const [campaigns, setCampaigns] = useState<BrandCampaign[]>([]);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');

  function load() {
    fetch(`/api/brand/${brandId}/campaigns`).then(r => r.json()).then(setCampaigns).catch(() => {});
  }
  useEffect(load, [brandId]);

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`/api/brand/${brandId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), keywords: keywords.split(',').map(k => k.trim()).filter(Boolean) }),
    });
    setName('');
    setKeywords('');
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/brand/${brandId}/campaigns/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="panel-header"><h2 className="section-title">New Campaign</h2></div>
        <div className="panel-body">
          <form onSubmit={createCampaign} className="flex flex-wrap gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Campaign name" className="flex-1 min-w-[160px]" />
            <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Keywords, comma-separated" className="flex-1 min-w-[220px]" />
            <button type="submit" className="brand-btn-primary btn btn-sm"><Plus size={13} /> Create Campaign</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Campaigns ({campaigns.length})</h2></div>
        <div className="panel-body">
          {campaigns.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Megaphone size={32} className="mx-auto text-muted-foreground" />
              <p className="font-semibold">No campaigns yet</p>
              <p className="text-sm text-muted-foreground">Create your first campaign to track and analyze keyword performance.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map(c => (
                <div key={c.id} className="brand-stat-tile flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.keywords.join(', ') || 'No keywords'} · created {formatDate(c.created_at)}</div>
                  </div>
                  <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
