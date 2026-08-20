'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export interface PageHeaderAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions = [],
  badge,
  children,
  className = '',
}: PageHeaderProps) {
  function renderAction(action: PageHeaderAction, defaultPrimary: boolean) {
    const Icon = action.icon;
    const variant = action.variant || (defaultPrimary ? 'primary' : 'ghost');
    
    let btnClass = 'btn btn-sm';
    if (variant === 'primary') btnClass += ' btn-primary';
    else if (variant === 'destructive') btnClass += ' btn-destructive';
    else btnClass += ' btn-ghost';

    const content = (
      <>
        {Icon && <Icon size={14} />}
        {action.label}
      </>
    );

    if (action.href) {
      return (
        <Link key={action.label} href={action.href} className={btnClass}>
          {content}
        </Link>
      );
    }

    return (
      <button key={action.label} onClick={action.onClick} className={btnClass}>
        {content}
      </button>
    );
  }

  return (
    <div className={`space-y-1 mb-5 ${className}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {badge}
        </div>

        {(primaryAction || secondaryActions.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            {secondaryActions.map(act => renderAction(act, false))}
            {primaryAction && renderAction(primaryAction, true)}
          </div>
        )}
      </div>

      {description && (
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-3xl">
          {description}
        </p>
      )}

      {children}
    </div>
  );
}
