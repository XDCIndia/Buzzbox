import type { LucideIcon } from 'lucide-react';

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand';

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
  neutral: 'badge-neutral',
  brand: 'count-badge',
};

/**
 * Compact status badge. Pass `dot` for a leading status dot (active/idle feels).
 * Maps to the existing badge-* utility classes so colors follow the theme.
 */
export function StatusBadge({
  tone = 'neutral',
  label,
  dot = false,
  icon: Icon,
}: {
  tone?: StatusTone;
  label: string;
  dot?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80 mr-1" aria-hidden />}
      {Icon && <Icon size={11} className="mr-1" />}
      {label}
    </span>
  );
}
