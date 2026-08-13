'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Search, Download, ExternalLink } from 'lucide-react';
import { MentionCard } from '@/components/brand/mention-card';
import { timeAgo } from '@/lib/utils';
import type { BrandMention } from '@/types';

const PLATFORMS = ['x', 'facebook', 'instagram', 'linkedin', 'reddit', 'tiktok', 'threads', 'youtube'];
const SENTIMENTS = ['positive', 'negative', 'neutral'];

export function MentionsTab({ brandId, realOnly, sourceType }: { brandId: string; realOnly: boolean; sourceType: 'social' | 'news' }) {
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [sentiments, setSentiments] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ source_type: sourceType, sort });
    if (realOnly) params.set('real', 'true');
    platforms.forEach(p => params.append('platform', p));
    sentiments.forEach(s => params.append('sentiment', s));
    if (search) params.set('search', search);
    setLoading(true);
    fetch(`/api/brand/${brandId}/mentions?${params.toString()}`).then(r => r.json()).then(setMentions).finally(() => setLoading(false));
  }, [brandId, realOnly, sourceType, sort, platforms, sentiments, search]);

  function onPatch(id: string, patch: Record<string, string>) {
    setMentions(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as BrandMention : m)));
    fetch(`/api/brand/${brandId}/mentions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/brand/${brandId}/mentions/sync`, { method: 'POST' });
      const data = await res.json();
      setSyncMsg(res.ok ? `Synced ${data.synced} new mention${data.synced === 1 ? '' : 's'} from X.` : data.error);
    } catch {
      setSyncMsg('Sync failed — check server logs.');
    } finally {
      setSyncing(false);
    }
  }

  function downloadCsv() {
    window.location.href = `/api/brand/${brandId}/export?source_type=${sourceType}${realOnly ? '&real=true' : ''}`;
  }

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  }

  const topStory = sourceType === 'news' ? mentions[0] : null;

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0 space-y-3">
        <div className="panel px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">{mentions.length} mention{mentions.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            {syncMsg && <span className="text-xs text-muted-foreground max-w-xs truncate">{syncMsg}</span>}
            <button onClick={downloadCsv} className="btn btn-ghost btn-sm"><Download size={12} /> Export</button>
            {sourceType === 'social' && (
              <button onClick={syncNow} disabled={syncing} className="brand-btn-primary btn btn-sm">
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
        </div>

        {topStory && (
          <section className="panel">
            <div className="panel-header"><h2 className="section-title">Top Story</h2></div>
            <div className="panel-body space-y-2">
              <div className="text-xs text-muted-foreground">{topStory.platform} · {timeAgo(topStory.published_at || topStory.created_at)}</div>
              <p className="text-base font-medium">{topStory.text}</p>
              {topStory.url && (
                <a href={topStory.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                  Read article <ExternalLink size={12} />
                </a>
              )}
            </div>
          </section>
        )}

        {loading ? (
          <div className="panel p-8 text-center text-muted-foreground text-sm">Loading mentions…</div>
        ) : mentions.length === 0 ? (
          <div className="panel p-8 text-center text-muted-foreground text-sm">No mentions match these filters yet.</div>
        ) : (
          <div className="space-y-3">
            {mentions.map(m => <MentionCard key={m.id} mention={m} onPatch={onPatch} />)}
          </div>
        )}
      </div>

      <aside className="w-64 shrink-0 space-y-3">
        <div className="panel p-3 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" className="w-full pl-8" />
          </div>
        </div>

        <div className="panel p-3 space-y-1.5">
          <div className="section-title mb-1">Sort by</div>
          {[{ key: 'newest', label: 'Newest first' }, { key: 'popular', label: 'Popularity' }, { key: 'reach', label: 'Reach' }].map(s => (
            <button key={s.key} onClick={() => setSort(s.key)} className={`brand-nav-item w-full text-left ${sort === s.key ? 'active' : ''}`}>
              {s.label}
            </button>
          ))}
        </div>

        {sourceType === 'social' && (
          <div className="panel p-3 space-y-1.5">
            <div className="section-title mb-1">Platforms</div>
            {PLATFORMS.map(p => (
              <label key={p} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(platforms, setPlatforms, p)} />
                <span className="capitalize">{p}</span>
              </label>
            ))}
          </div>
        )}

        <div className="panel p-3 space-y-1.5">
          <div className="section-title mb-1">Sentiment</div>
          {SENTIMENTS.map(s => (
            <label key={s} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
              <input type="checkbox" checked={sentiments.includes(s)} onChange={() => toggle(sentiments, setSentiments, s)} />
              <span className="capitalize">{s}</span>
            </label>
          ))}
        </div>
      </aside>
    </div>
  );
}
