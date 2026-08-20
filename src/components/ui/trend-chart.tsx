'use client';

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

interface TrendChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  lines: { key: string; color: string; label: string }[];
  height?: number;
}

export function TrendChart({ data, xKey, lines, height = 260 }: TrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height }}>
        <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-muted-foreground">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No trend data yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">Performance trends will appear once activity is recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey={xKey}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--foreground)' }}
        />
        {lines.map(line => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
            name={line.label}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
