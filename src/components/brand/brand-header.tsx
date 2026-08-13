'use client';

import { useEffect, useState } from 'react';
import type { Brand } from '@/types';

export function BrandHeader({ brandId, title }: { brandId: string; title: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);

  useEffect(() => {
    fetch(`/api/brand/${brandId}`).then(r => r.json()).then(setBrand).catch(() => {});
  }, [brandId]);

  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <h1 className="text-xl font-semibold">{title}{brand ? ` — ${brand.name}` : ''}</h1>
    </div>
  );
}
