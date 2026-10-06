'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/toast';
import type { ContentPlatform } from '@/types';

const PLATFORMS: { value: ContentPlatform; label: string }[] = [
  { value: 'x', label: 'X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'blog', label: 'Blog' },
];

/** X posts are limited to 280 characters by the platform (server accepts the
 * draft regardless; the warning keeps authors from writing unpostable drafts). */
const X_CHAR_LIMIT = 280;

export default function NewContentPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState<ContentPlatform>('x');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const overXLimit = platform === 'x' && trimmed.length > X_CHAR_LIMIT;

  async function saveDraft() {
    if (saving) return;
    if (!trimmed) {
      setError('Write something first — a draft needs post text.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, platform }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'Please log in, then try saving again.'
            : String(data?.error || `Could not save the draft (${res.status})`),
        );
      }
      toast.success('Draft saved to the Content queue');
      router.push('/content');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the draft';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="02"
        eyebrow="Operate"
        title="New draft"
        description="Write your post here → choose platform → save as draft."
      />

      <div className="panel">
        <div className="panel-body space-y-4">
          <div>
            <label htmlFor="draft-text" className="text-xs font-medium text-muted-foreground">
              Post text
            </label>
            <textarea
              id="draft-text"
              className="mt-1.5 w-full min-h-36 rounded-lg border border-border bg-surface-1 p-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Write your post…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={saving}
            />
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className={overXLimit ? 'text-warning font-medium' : 'text-muted-foreground'}>
                {trimmed.length}{platform === 'x' ? ` / ${X_CHAR_LIMIT}` : ' characters'}
                {overXLimit ? ' — over the X limit; shorten before publishing' : ''}
              </span>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Platform</div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={saving}
                  onClick={() => setPlatform(p.value)}
                  aria-pressed={platform === p.value}
                  className={`btn btn-sm ${platform === p.value ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-destructive font-medium" role="alert">
              {error}{' '}
              {error.startsWith('Please log in') && (
                <Link href="/login" className="underline">Go to login</Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving || !trimmed}
              className="btn btn-primary btn-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <Link href="/content" className="btn btn-ghost btn-sm">
              Cancel
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Saving stores a draft in the Content queue. Nothing is published — publishing still goes through the existing approval workflow.
          </p>
        </div>
      </div>
    </div>
  );
}
