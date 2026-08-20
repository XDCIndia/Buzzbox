'use client';

export function StatCardSkeleton() {
  return (
    <div className="card p-4 space-y-2 animate-pulse bg-muted/20">
      <div className="h-3 w-20 bg-muted-foreground/20 rounded" />
      <div className="h-7 w-28 bg-muted-foreground/30 rounded" />
      <div className="h-3 w-16 bg-muted-foreground/15 rounded" />
    </div>
  );
}

export function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 bg-muted/30 rounded-lg w-full" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-2 border-b border-border/30">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 bg-muted-foreground/20 rounded flex-1"
              style={{ width: `${100 / cols}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="panel p-4 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 bg-muted-foreground/25 rounded" />
        <div className="h-3 w-16 bg-muted-foreground/15 rounded" />
      </div>
      <div
        className="w-full bg-muted/20 rounded-lg flex items-end p-4 gap-2"
        style={{ height: `${height}px` }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-muted-foreground/20 rounded-t"
            style={{ height: `${20 + ((i * 17) % 70)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function BrandHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 animate-pulse py-1">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted-foreground/20" />
        <div className="space-y-1">
          <div className="h-5 w-48 bg-muted-foreground/30 rounded" />
          <div className="h-3 w-32 bg-muted-foreground/15 rounded" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="h-6 w-16 bg-muted-foreground/15 rounded-full" />
        <div className="h-6 w-16 bg-muted-foreground/15 rounded-full" />
      </div>
    </div>
  );
}

export function CardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel p-4 space-y-2">
          <div className="flex justify-between items-center">
            <div className="h-4 w-36 bg-muted-foreground/25 rounded" />
            <div className="h-3 w-16 bg-muted-foreground/15 rounded" />
          </div>
          <div className="h-3 w-full bg-muted-foreground/15 rounded" />
          <div className="h-3 w-2/3 bg-muted-foreground/10 rounded" />
        </div>
      ))}
    </div>
  );
}
