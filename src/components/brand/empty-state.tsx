import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title?: string;
  description: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** 'compact' is for empty states nested inside an already-small panel (e.g. a card within a grid). */
  variant?: 'default' | 'compact' | 'card';
  className?: string;
}

const SIZES = {
  default: { iconSize: 32, className: 'text-center py-10 space-y-2' },
  compact: { iconSize: 24, className: 'text-center py-6 space-y-1' },
  card: { iconSize: 32, className: 'panel p-8 text-center space-y-3' },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  variant = 'default',
  className: extraClassName = '',
}: EmptyStateProps) {
  const { iconSize, className } = SIZES[variant];

  function renderBtn(action: EmptyStateAction, isPrimary: boolean) {
    const BtnIcon = action.icon;
    const btnClass = isPrimary ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    const content = (
      <>
        {BtnIcon && <BtnIcon size={13} />}
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
    <div className={`${className} ${extraClassName}`}>
      <Icon size={iconSize} className="mx-auto text-muted-foreground" />
      {title && <p className="font-semibold text-foreground text-sm md:text-base">{title}</p>}
      <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">{description}</p>
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
          {primaryAction && renderBtn(primaryAction, true)}
          {secondaryAction && renderBtn(secondaryAction, false)}
        </div>
      )}
    </div>
  );
}
