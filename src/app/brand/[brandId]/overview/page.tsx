'use client';

import { useParams } from 'next/navigation';
import { useDashboard } from '@/store';
import { BrandHeader } from '@/components/brand/brand-header';
import { OverviewTab } from '@/components/brand/tabs/overview-tab';

export default function BrandOverviewPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const realOnly = useDashboard(s => s.realOnly);

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="Brand Overview" index="B1" description="Live view of brand health — mentions, engagement, and share of voice across connected sources." />
      <OverviewTab brandId={brandId} realOnly={realOnly} />
    </div>
  );
}
