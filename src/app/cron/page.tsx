'use client';

import { CronBoard } from '@/components/cron/cron-board';
import { PageHeader } from '@/components/ui/page-header';

export default function CronBoardPage() {
  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="15"
        eyebrow="System"
        title="Cron"
        description="Scheduled agent jobs, runs, and history."
      />
      <CronBoard variant="page" />
    </div>
  );
}
