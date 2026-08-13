'use client';

import { ChevronDown } from 'lucide-react';

const OPTIONS: Record<string, string[]> = {
  sentiment: ['positive', 'negative', 'neutral'],
  emotion: ['joy', 'sadness', 'anger', 'fear', 'surprise', 'neutral'],
  intent: ['news', 'question', 'promotion', 'praise', 'complaint', 'other'],
};

function chipClass(kind: string, value: string | null): string {
  if (kind === 'sentiment') {
    if (value === 'positive') return 'brand-chip-positive';
    if (value === 'negative') return 'brand-chip-negative';
  }
  return 'brand-chip-neutral';
}

interface SentimentChipProps {
  kind: 'sentiment' | 'emotion' | 'intent';
  value: string | null;
  onChange: (value: string) => void;
}

export function SentimentChip({ kind, value, onChange }: SentimentChipProps) {
  const display = value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Unclassified';
  return (
    <span className={`brand-chip ${chipClass(kind, value)} relative`}>
      {display}
      <ChevronDown size={11} />
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label={kind}
      >
        <option value="" disabled>Unclassified</option>
        {OPTIONS[kind].map(o => (
          <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
        ))}
      </select>
    </span>
  );
}
