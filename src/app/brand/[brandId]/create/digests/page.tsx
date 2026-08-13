'use client';

import { useParams } from 'next/navigation';
import { BrandHeader } from '@/components/brand/brand-header';
import { DigestsTab } from '@/components/brand/tabs/digests-tab';

export default function BrandDigestsPage() {
  const { brandId } = useParams<{ brandId: string }>();

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="AI Digests" />
      <DigestsTab brandId={brandId} />
    </div>
  );
}
