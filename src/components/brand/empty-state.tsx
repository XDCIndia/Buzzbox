import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title?: string;
  description: string;
  /** 'compact' is for empty states nested inside an already-small panel (e.g. a card within a grid). */
  variant?: 'default' | 'compact';
}

const SIZES = {
  default: { iconSize: 32, className: 'text-center py-10 space-y-2' },
  compact: { iconSize: 26, className: 'text-center py-6 space-y-1' },
};

export function EmptyState({ icon: Icon, title, description, variant = 'default' }: EmptyStateProps) {
  const { iconSize, className } = SIZES[variant];
  return (
    <div className={className}>
      <Icon size={iconSize} className="mx-auto text-muted-foreground" />
      {title && <p className="font-semibold">{title}</p>}
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
