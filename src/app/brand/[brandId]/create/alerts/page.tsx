'use client';

import { useParams } from 'next/navigation';
import { BrandHeader } from '@/components/brand/brand-header';
import { AlertsTab } from '@/components/brand/tabs/alerts-tab';

export default function BrandAlertsPage() {
  const { brandId } = useParams<{ brandId: string }>();

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="Alerts" />
      <AlertsTab brandId={brandId} />
    </div>
  );
}
