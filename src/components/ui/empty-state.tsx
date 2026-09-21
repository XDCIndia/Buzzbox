'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * Explains itself: what this area is for, why it is empty, and what to do next.
 * `variant="inline"` fits inside cards/panels; default renders as a full panel.
 */
export function EmptyState({
  icon: Icon,
  title,
  reason,
  next,
  action,
  variant = 'panel',
}: {
  icon: LucideIcon;
  /** What this section is */
  title: string;
  /** Why there is no data yet */
  reason: string;
  /** What the user can do about it */
  next?: string;
  action?: { label: string; href: string };
  variant?: 'panel' | 'inline';
}) {
  const inner = (
    <>
      <div className={`flex items-center justify-center rounded-lg border border-border/60 bg-surface-1 ${variant === 'panel' ? 'h-11 w-11 mb-4' : 'h-8 w-8 mb-2.5'}`}>
        <Icon size={variant === 'panel' ? 18 : 15} className="text-muted-foreground/70" />
      </div>
      <p className={`font-semibold text-foreground ${variant === 'panel' ? 'text-sm' : 'text-xs'}`}>{title}</p>
      <p className={`text-muted-foreground max-w-[24rem] ${variant === 'panel' ? 'text-xs mt-1.5' : 'text-[11px] mt-1'}`}>
        {reason}
        {next && <> {next}</>}
      </p>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline mt-3 focus:outline-none focus:ring-1 focus:ring-primary rounded"
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      )}
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="py-5 px-4 flex flex-col items-center text-center">
        {inner}
      </div>
    );
  }

  return (
    <div className="py-10 px-6 rounded-lg border border-dashed border-border/70 bg-surface-1/40 flex flex-col items-center text-center">
      {inner}
    </div>
  );
}

/**
 * Restrained error block: explicit title, detail, retry, and optional details link.
 */
export function ErrorState({
  title = 'Something went wrong',
  detail,
  onRetry,
  retryLabel = 'Retry',
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="py-8 px-6 rounded-lg border border-destructive/25 bg-destructive/5 flex flex-col items-center text-center"
    >
      <p className="console-eyebrow mb-2" style={{ color: 'var(--destructive)' }}>Error</p>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {detail && <p className="text-xs text-muted-foreground mt-1.5 max-w-sm">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-sm btn-destructive mt-4"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
