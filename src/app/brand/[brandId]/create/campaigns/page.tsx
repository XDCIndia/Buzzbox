'use client';

import { useParams } from 'next/navigation';
import { BrandHeader } from '@/components/brand/brand-header';
import { CampaignsTab } from '@/components/brand/tabs/campaigns-tab';

export default function BrandCampaignsPage() {
  const { brandId } = useParams<{ brandId: string }>();

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="Campaigns" index="B5" description="Organized engagement campaigns — group mentions into sequences and track outreach progress." />
      <CampaignsTab brandId={brandId} />
    </div>
  );
}
