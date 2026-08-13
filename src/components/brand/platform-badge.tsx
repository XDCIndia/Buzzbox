const PLATFORM_META: Record<string, { label: string; color: string }> = {
  x: { label: 'X', color: '#111318' },
  facebook: { label: 'FB', color: '#1877f2' },
  instagram: { label: 'IG', color: '#e1306c' },
  linkedin: { label: 'in', color: '#0a66c2' },
  reddit: { label: 'r/', color: '#ff4500' },
  tiktok: { label: 'TT', color: '#111318' },
  threads: { label: '@', color: '#111318' },
  youtube: { label: 'YT', color: '#ff0000' },
  news: { label: 'N', color: '#6c7284' },
};

export function PlatformBadge({ platform, size = 22 }: { platform: string; size?: number }) {
  const meta = PLATFORM_META[platform] || { label: platform.slice(0, 2).toUpperCase(), color: '#6c7284' };
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
      style={{ width: size, height: size, background: meta.color }}
      title={platform}
    >
      {meta.label}
    </span>
  );
}
