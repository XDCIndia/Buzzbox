'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Download, ExternalLink, AtSign } from 'lucide-react';
import { MentionCard } from '@/components/brand/mention-card';
import { FilterPanel } from '@/components/brand/filter-panel';
import { MENTION_PLATFORMS, MENTION_SENTIMENTS } from '@/lib/brand-constants';
import { timeAgo } from '@/lib/utils';
import { EmptyState } from '@/components/brand/empty-state';
import { CardSkeletonList } from '@/components/ui/loading-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import type { BrandMention } from '@/types';

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'popular', label: 'Popularity' },
  { key: 'reach', label: 'Reach' },
];

export function MentionsTab({ brandId, realOnly, sourceType }: { brandId: string; realOnly: boolean; sourceType: 'social' | 'news' }) {
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [sentiments, setSentiments] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  function loadMentions() {
    const params = new URLSearchParams({ source_type: sourceType, sort });
    if (realOnly) params.set('real', 'true');
    platforms.forEach(p => params.append('platform', p));
    sentiments.forEach(s => params.append('sentiment', s));
    if (search) params.set('search', search);
    setLoading(true);
    setError(null);

    fetch(`/api/brand/${brandId}/mentions?${params.toString()}`)
      .then(async r => {
        if (!r.ok) throw new Error('Failed to load mentions');
        return r.json();
      })
      .then((data: BrandMention[]) => setMentions(Array.isArray(data) ? data : []))
      .catch(err => setError((err as Error).message || 'Could not fetch mentions'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMentions();
  }, [brandId, realOnly, sourceType, sort, platforms, sentiments, search]);

  function onPatch(id: string, patch: Record<string, string>) {
    setMentions(prev => prev.map(m => (m.id === id ? { ...m, ...patch } as BrandMention : m)));
    fetch(`/api/brand/${brandId}/mentions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/brand/${brandId}/mentions/sync`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSyncMsg(`Synced ${data.synced} new mention${data.synced === 1 ? '' : 's'}.`);
        loadMentions();
      } else {
        setSyncMsg(data.error ? 'Sync failed — provider not connected.' : 'Sync failed');
      }
    } catch {
      setSyncMsg('Sync failed — check network connection.');
    } finally {
      setSyncing(false);
    }
  }

  function downloadCsv() {
    window.location.href = `/api/brand/${brandId}/export?source_type=${sourceType}${realOnly ? '&real=true' : ''}`;
  }

  const topStory = sourceType === 'news' ? mentions[0] : null;
  const hasActiveFilters = Boolean(search || platforms.length > 0 || sentiments.length > 0);

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
          <CardSkeletonList count={4} />
        ) : error ? (
          <ErrorBanner
            title="Unable to load mentions"
            message={error}
            onRetry={loadMentions}
          />
        ) : mentions.length === 0 ? (
          <EmptyState
            icon={AtSign}
            title={hasActiveFilters ? 'No matching mentions' : 'Start monitoring your brand'}
            description={
              hasActiveFilters
                ? 'No mentions matched your active filter criteria. Try adjusting search or sentiment filters.'
                : 'Connect your data source and sync mentions to begin tracking conversations.'
            }
            primaryAction={
              sourceType === 'social'
                ? { label: 'Sync Mentions', onClick: syncNow, icon: RefreshCw }
                : undefined
            }
            secondaryAction={
              hasActiveFilters
                ? {
                    label: 'Clear Filters',
                    onClick: () => {
                      setSearch('');
                      setPlatforms([]);
                      setSentiments([]);
                    },
                  }
                : undefined
            }
            variant="card"
          />
        ) : (
          <div className="space-y-3">
            {mentions.map(m => <MentionCard key={m.id} mention={m} onPatch={onPatch} />)}
          </div>
        )}
      </div>

      <FilterPanel
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        sortOptions={SORT_OPTIONS}
        platformOptions={sourceType === 'social' ? MENTION_PLATFORMS : undefined}
        platforms={sourceType === 'social' ? platforms : undefined}
        onPlatformsChange={sourceType === 'social' ? setPlatforms : undefined}
        sentimentOptions={MENTION_SENTIMENTS}
        sentiments={sentiments}
        onSentimentsChange={setSentiments}
      />
    </div>
  );
}
