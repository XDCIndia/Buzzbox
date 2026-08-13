'use client';

import { ExternalLink, Heart, MessageCircle, AlertTriangle } from 'lucide-react';
import { formatNumber, timeAgo } from '@/lib/utils';
import { PlatformBadge } from './platform-badge';
import { SentimentChip } from './sentiment-chip';
import type { BrandMention } from '@/types';

interface MentionCardProps {
  mention: BrandMention;
  onPatch: (id: string, patch: { sentiment?: string; emotion?: string; intent?: string }) => void;
}

export function MentionCard({ mention: m, onPatch }: MentionCardProps) {
  return (
    <div className="panel card-hover p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PlatformBadge platform={m.platform} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{m.author_name || m.author_handle || 'Unknown source'}</div>
            {m.author_reach > 0 && (
              <div className="text-xs text-muted-foreground">{formatNumber(m.author_reach)} reach</div>
            )}
          </div>
          {m.is_crisis === true && (
            <span className="badge badge-error inline-flex items-center gap-1"><AlertTriangle size={11} /> Crisis</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(m.published_at || m.created_at)}</span>
      </div>

      <p className="text-sm leading-relaxed">{m.text}</p>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Heart size={12} /> {formatNumber(m.likes)}</span>
          <span className="inline-flex items-center gap-1"><MessageCircle size={12} /> {formatNumber(m.comments)}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <SentimentChip kind="sentiment" value={m.sentiment} onChange={v => onPatch(m.id, { sentiment: v })} />
          <SentimentChip kind="emotion" value={m.emotion} onChange={v => onPatch(m.id, { emotion: v })} />
          {m.url && (
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              Visit <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
