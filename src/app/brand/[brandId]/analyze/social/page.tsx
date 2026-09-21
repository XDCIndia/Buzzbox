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
      <BrandHeader brandId={brandId} title="Brand Analytics" index="B3" description="Trends and engagement breakdowns for your brand's social presence over time." />
      <AnalyticsTab brandId={brandId} realOnly={realOnly} />
    </div>
  );
}
