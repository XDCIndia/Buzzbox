'use client';

import type { LucideIcon } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

interface StatTileProps {
  label: string;
  value: number;
  icon: LucideIcon;
  color?: string;
  format?: (n: number) => string;
  sublabel?: string;
}

export function StatTile({ label, value, icon: Icon, color = 'var(--brand-coral)', format = formatNumber, sublabel }: StatTileProps) {
  return (
    <div className="brand-stat-tile card-hover">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground mb-1">{label}</p>
          <p className="text-2xl font-bold font-mono tracking-tight">{format(value)}</p>
          {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
    </div>
  );
}
