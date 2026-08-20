'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Plug, Settings } from 'lucide-react';

interface ProviderConfigCardProps {
  title: string;
  description: string;
  providerName: string;
  icon?: LucideIcon;
  configureHref?: string;
  configureLabel?: string;
  error?: string;
  className?: string;
}

export function ProviderConfigCard({
  title,
  description,
  providerName,
  icon: Icon = Plug,
  configureHref = '/integrations',
  configureLabel = 'Configure Integration',
  error,
  className = '',
}: ProviderConfigCardProps) {
  return (
    <div className={`panel p-6 border-dashed border-border/70 space-y-4 text-center ${className}`}>
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
        <Icon size={20} />
      </div>
      <div className="space-y-1 max-w-sm mx-auto">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        {error && (
          <p className="text-xs text-warning pt-1 font-medium">{error}</p>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 pt-1">
        <Link
          href={configureHref}
          className="btn btn-primary btn-sm flex items-center gap-1.5"
        >
          <Settings size={13} />
          {configureLabel}
        </Link>
      </div>
    </div>
  );
}
