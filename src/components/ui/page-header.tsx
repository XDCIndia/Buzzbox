'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * Consistent page header: mono eyebrow (optional "01 /" index), editorial
 * display heading, short description, and an optional primary action.
 *
 *   <PageHeader index="01" eyebrow="Overview" title="Operational overview"
 *     description="Monitor activity across your workspace."
 *     action={{ label: 'New campaign', href: '/content' }} />
 */
export function PageHeader({
  index,
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  /** Optional section number rendered as "01 /" before the eyebrow */
  index?: string;
  /** Small uppercase label above the title */
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { label: string; href: string; icon?: React.ReactNode };
  /** Extra content rendered beside the action (filters, toggles…) */
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-8">
      <div className="min-w-0">
        {(eyebrow || index) && (
          <p className="console-eyebrow mb-3">
            {index && <span className="opacity-80">{index} /</span>} {eyebrow}
          </p>
        )}
        <h1 className="page-headline">{title}</h1>
        {description && <p className="page-subheadline mt-2 max-w-2xl">{description}</p>}
      </div>
      {(action || children) && (
        <div className="flex items-center gap-3 shrink-0">
          {children}
          {action && (
            <Link href={action.href} className="btn btn-primary btn-lg">
              {action.label}
              {action.icon ?? <ArrowRight size={16} />}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
