'use client';

import { useState } from 'react';
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface ErrorBannerProps {
  title?: string;
  message: string;
  explanation?: string;
  onRetry?: () => void;
  technicalDetails?: string | Record<string, unknown>;
  variant?: 'inline' | 'card' | 'full-page';
  className?: string;
}

export function ErrorBanner({
  title = 'Something went wrong',
  message,
  explanation,
  onRetry,
  technicalDetails,
  variant = 'card',
  className = '',
}: ErrorBannerProps) {
  const [showTech, setShowTech] = useState(false);

  // Ensure message is never undefined or empty object
  const safeMessage = typeof message === 'string' && message ? message : 'An unexpected error occurred.';
  const safeTitle = typeof title === 'string' && title ? title : 'Error';

  const techString = technicalDetails
    ? typeof technicalDetails === 'string'
      ? technicalDetails
      : JSON.stringify(technicalDetails, null, 2)
    : null;

  if (variant === 'inline') {
    return (
      <div className={`p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center justify-between gap-3 ${className}`}>
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle size={14} className="shrink-0" />
          <span className="truncate">{safeMessage}</span>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn btn-ghost btn-sm text-xs font-medium hover:bg-destructive/20 shrink-0 flex items-center gap-1"
          >
            <RefreshCw size={11} /> Retry
          </button>
        )}
      </div>
    );
  }

  const containerClass = variant === 'full-page'
    ? 'panel p-8 text-center max-w-md mx-auto my-8 space-y-4'
    : 'panel p-4 space-y-3 border-destructive/30 bg-destructive/5';

  return (
    <div className={`${containerClass} ${className}`}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-destructive/15 text-destructive flex items-center justify-center shrink-0 mt-0.5">
          <AlertCircle size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{safeTitle}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{safeMessage}</p>
          {explanation && (
            <p className="text-xs text-muted-foreground/80 mt-1">{explanation}</p>
          )}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn btn-ghost btn-sm shrink-0 flex items-center gap-1 text-xs"
          >
            <RefreshCw size={12} /> Retry
          </button>
        )}
      </div>

      {techString && (
        <div className="pt-2 border-t border-border/40">
          <button
            onClick={() => setShowTech(!showTech)}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {showTech ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showTech ? 'Hide details' : 'Show details'}
          </button>
          {showTech && (
            <pre className="mt-2 p-2 rounded bg-muted/60 text-[10px] font-mono text-muted-foreground overflow-x-auto max-h-32">
              {techString}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
