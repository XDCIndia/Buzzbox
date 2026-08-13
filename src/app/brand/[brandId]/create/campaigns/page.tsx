'use client';

import { useParams } from 'next/navigation';
import { BrandHeader } from '@/components/brand/brand-header';
import { CampaignsTab } from '@/components/brand/tabs/campaigns-tab';

export default function BrandCampaignsPage() {
  const { brandId } = useParams<{ brandId: string }>();

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="Campaigns" />
      <CampaignsTab brandId={brandId} />
    </div>
  );
}
