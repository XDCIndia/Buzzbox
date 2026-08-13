'use client';

import { useParams } from 'next/navigation';
import { useDashboard } from '@/store';
import { BrandHeader } from '@/components/brand/brand-header';
import { MentionsTab } from '@/components/brand/tabs/mentions-tab';

export default function BrandNewsMentionsPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const realOnly = useDashboard(s => s.realOnly);

  return (
    <div className="space-y-4 animate-in">
      <BrandHeader brandId={brandId} title="News Mentions" />
      <MentionsTab brandId={brandId} realOnly={realOnly} sourceType="news" />
    </div>
  );
}
