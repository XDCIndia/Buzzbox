'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Tag, Radio, AlertCircle, RefreshCw, Settings, Compass, Info } from 'lucide-react';
import type { Brand } from '@/types';
import { DEFAULT_BRAND_ID } from '@/lib/brand-constants';
import { BrandHeaderSkeleton } from '@/components/ui/loading-skeleton';

export function BrandHeader({ brandId, title, index, description }: { brandId: string; title: string; index?: string; description?: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadBrand() {
    fetch(`/api/brand/${brandId}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Brand not found');
        }
        setBrand(data);
      })
      .catch(err => {
        setBrand(null);
        setError((err as Error).message || 'Brand not found');
      })
      // NOTE: A previous implementation reset loading/error state synchronously at the
      // top of this function. That pattern is flagged by react-hooks (setState during
      // render phase of an effect); state now resolves asynchronously via the fetch chain.
      .finally(() => setLoading(false));
  }

  function retryBrand() {
    setLoading(true);
    setError(null);
    loadBrand();
  }

  useEffect(() => {
    loadBrand();
  }, [brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="panel p-4 space-y-2">
        <BrandHeaderSkeleton />
      </div>
    );
  }

  if (error || !brand) {
    const is404 = error?.toLowerCase().includes('not found') || !brand;
    return (
      <div className="panel p-4 border-destructive/30 bg-destructive/5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-destructive/15 text-destructive flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {is404 ? 'Brand not found' : 'Failed to load brand'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {is404
                  ? 'The selected brand is not configured yet or the ID is invalid.'
                  : error || 'An error occurred while retrieving brand details.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={retryBrand} className="btn btn-ghost btn-sm text-xs">
              <RefreshCw size={12} /> Retry
            </button>
            {brandId !== DEFAULT_BRAND_ID && (
              <Link href={`/brand/${DEFAULT_BRAND_ID}/overview`} className="btn btn-primary btn-sm text-xs flex items-center gap-1">
                <Compass size={12} /> Go to Default Brand
              </Link>
            )}
            <Link href="/settings?tab=brand" className="btn btn-ghost btn-sm text-xs flex items-center gap-1">
              <Settings size={12} /> Brand Settings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const hasKeywords = brand.keywords && brand.keywords.length > 0;
  const hasSources = brand.sources && brand.sources.length > 0;

  return (
    <section className="mb-8 space-y-3">
      {Boolean(brand.is_demo) && (
        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-start gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-foreground">This is demo data</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                &quot;{brand.name}&quot; was seeded by the Buzzbox demo script — the mentions, campaigns and metrics on this page are placeholder content, not your accounts. Rename the brand to yours to start tracking it.
              </p>
            </div>
          </div>
          <Link href="/settings?tab=brand" className="btn btn-primary btn-sm text-xs shrink-0 flex items-center gap-1">
            <Settings size={12} /> Rename brand
          </Link>
        </div>
      )}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="console-eyebrow mb-3">
            {index && <span className="opacity-80">{index} /</span>} Brand — {brand.name}
          </p>
          <h1 className="page-headline">{title}</h1>
          <p className="page-subheadline mt-2 max-w-2xl">
            {description ?? 'Active brand context for social listening, mentions triage, and reporting'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href="/settings?tab=brand" className="btn btn-ghost btn-sm text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Settings size={12} /> Manage Brand
          </Link>
        </div>
      </div>

      {(hasKeywords || hasSources) && (
        <div className="flex items-center gap-4 flex-wrap border-b border-border/40 pb-3 text-xs">
          {hasKeywords && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag size={12} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium text-[11px]">Tracking:</span>
              {brand.keywords!.map(kw => (
                <span key={kw} className="badge badge-neutral text-[10px]">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {hasSources && (
            <div className="flex items-center gap-1.5 flex-wrap lg:ml-auto">
              <Radio size={12} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium text-[11px]">Sources:</span>
              {brand.sources!.map(src => (
                <span key={src} className="badge badge-info text-[10px] uppercase">
                  {src}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
