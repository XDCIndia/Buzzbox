'use client';

import { useParams } from 'next/navigation';
import { useDashboard } from '@/store';
import { BrandHeader } from '@/components/brand/brand-header';
import { AnalyticsTab } from '@/components/brand/tabs/analytics-tab';

export default function BrandAnalyticsPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const realOnly = useDashboard(s => s.realOnly);

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="Social Analytics" />
      <AnalyticsTab brandId={brandId} realOnly={realOnly} />
    </div>
  );
}
