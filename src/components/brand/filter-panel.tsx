'use client';

import { Search } from 'lucide-react';

interface SortOption {
  key: string;
  label: string;
}

interface FilterPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  sort: string;
  onSortChange: (value: string) => void;
  sortOptions: SortOption[];
  platformOptions?: string[];
  platforms?: string[];
  onPlatformsChange?: (value: string[]) => void;
  sentimentOptions: string[];
  sentiments: string[];
  onSentimentsChange: (value: string[]) => void;
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

export function FilterPanel({
  search,
  onSearchChange,
  sort,
  onSortChange,
  sortOptions,
  platformOptions,
  platforms,
  onPlatformsChange,
  sentimentOptions,
  sentiments,
  onSentimentsChange,
}: FilterPanelProps) {
  return (
    <aside className="w-64 shrink-0 space-y-3">
      <div className="panel p-3 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => onSearchChange(e.target.value)} placeholder="Search" className="w-full pl-8" />
        </div>
      </div>

      <div className="panel p-3 space-y-1.5">
        <div className="section-title mb-1">Sort by</div>
        {sortOptions.map(s => (
          <button key={s.key} onClick={() => onSortChange(s.key)} className={`brand-nav-item w-full text-left ${sort === s.key ? 'active' : ''}`}>
            {s.label}
          </button>
        ))}
      </div>

      {platformOptions && platforms && onPlatformsChange && (
        <div className="panel p-3 space-y-1.5">
          <div className="section-title mb-1">Platforms</div>
          {platformOptions.map(p => (
            <label key={p} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
              <input type="checkbox" checked={platforms.includes(p)} onChange={() => onPlatformsChange(toggle(platforms, p))} />
              <span className="capitalize">{p}</span>
            </label>
          ))}
        </div>
      )}

      <div className="panel p-3 space-y-1.5">
        <div className="section-title mb-1">Sentiment</div>
        {sentimentOptions.map(s => (
          <label key={s} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
            <input type="checkbox" checked={sentiments.includes(s)} onChange={() => onSentimentsChange(toggle(sentiments, s))} />
            <span className="capitalize">{s}</span>
          </label>
        ))}
      </div>
    </aside>
  );
}
