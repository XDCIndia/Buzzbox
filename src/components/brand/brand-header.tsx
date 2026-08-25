'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Tag, Radio, AlertCircle, RefreshCw, Settings, Compass } from 'lucide-react';
import type { Brand } from '@/types';
import { DEFAULT_BRAND_ID } from '@/lib/brand-constants';
import { BrandHeaderSkeleton } from '@/components/ui/loading-skeleton';

export function BrandHeader({ brandId, title }: { brandId: string; title: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBrand = useCallback(() => {
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
      .finally(() => setLoading(false));
  }, [brandId]);

  useEffect(() => {
    loadBrand();
  }, [loadBrand]);

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
            <button onClick={loadBrand} className="btn btn-ghost btn-sm text-xs">
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

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{title}</h1>
            <span className="text-muted-foreground font-light text-xl">—</span>
            <span className="text-xl font-medium text-primary">{brand.name}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Active brand context for social listening, mentions triage, and reporting
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/settings?tab=brand" className="btn btn-ghost btn-sm text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Settings size={12} /> Manage Brand
          </Link>
        </div>
      </div>

      {((brand.keywords && brand.keywords.length > 0) || (brand.sources && brand.sources.length > 0)) && (
        <div className="flex items-center gap-4 pt-1 flex-wrap border-t border-border/40 text-xs">
          {brand.keywords && brand.keywords.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag size={12} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium text-[11px]">Tracking:</span>
              {brand.keywords.map(kw => (
                <span key={kw} className="badge badge-neutral text-[10px]">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {brand.sources && brand.sources.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap ml-auto">
              <Radio size={12} className="text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium text-[11px]">Sources:</span>
              {brand.sources.map(src => (
                <span key={src} className="badge badge-info text-[10px] uppercase">
                  {src}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
