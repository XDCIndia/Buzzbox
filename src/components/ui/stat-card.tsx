'use client';

import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  trend?: number;
  sparkline?: { value: number }[];
  color?: string;
}

export function StatCard({ label, value, icon: Icon, trend, sparkline, color = 'var(--primary)' }: StatCardProps) {
  const gradientId = `gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div className="card card-hover relative p-6 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight font-mono">{formatNumber(value)}</p>
          {trend !== undefined && (
            <p className={`text-sm mt-2 ${trend >= 0 ? 'text-success' : 'text-destructive'}`}>
              {trend >= 0 ? '+' : ''}{trend.toFixed(1)}% vs last week
            </p>
          )}
        </div>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 12%, var(--surface-2))`, color }}
        >
          <Icon size={20} />
        </div>
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="h-14 mt-5">
          {/* Fixed pixel height (matches h-14) instead of "100%" so Recharts has a
              real, non-percentage size to measure on first mount -- a percentage
              height resolves to the ResponsiveContainer's -1 initial dimension
              before ResizeObserver fires, which triggers its zero-size warning. */}
          <ResponsiveContainer width="100%" height={56}>
            <AreaChart data={sparkline}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
