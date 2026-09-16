'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Sparkles, PenLine, Bot, Circle, ChevronRight, Loader2,
  AlertTriangle, CheckCircle2, Clock, Mail, Send,
} from 'lucide-react';
import { DEFAULT_BRAND_ID } from '@/lib/brand-constants';

/* ─── Setup checklist ───────────────────────────────────── */

interface SetupStatus {
  xConnected: boolean;
  brandKeywords: boolean;
  hasContent: boolean;
  agentActive: boolean;
}

function useSetupStatus(): SetupStatus | null {
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, brand, content, overview] = await Promise.all([
        fetch('/api/settings').then(r => r.json()).catch(() => null),
        fetch(`/api/brand/${DEFAULT_BRAND_ID}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/content').then(r => r.json()).catch(() => null),
        fetch('/api/overview').then(r => r.json()).catch(() => null),
      ]);
      if (cancelled) return;
      const xUser = process.env.NEXT_PUBLIC_X_USERNAME;
      setStatus({
        xConnected: Boolean(xUser) || Boolean(settings?.integrations?.x),
        brandKeywords: Array.isArray(brand?.keywords) ? brand.keywords.length > 0 : false,
        hasContent: Number(content?.items?.length ?? content?.length ?? 0) > 0,
        agentActive: (overview?.agents ?? []).some((a: { status: string }) => a.status === 'active'),
      });
    })();
    return () => { cancelled = true; };
  }, []);

  return status;
}

export function SetupChecklist() {
  const status = useSetupStatus();

  if (!status) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Checking workspace setup…
        </div>
      </div>
    );
  }

  const steps = [
    { key: 'x', label: 'Connect the X account', hint: 'Unlocks posting, search, and signals', href: '/integrations', done: status.xConnected },
    { key: 'kw', label: 'Add brand keywords', hint: 'What mentions and research listen for', href: `/brand/${DEFAULT_BRAND_ID}/overview`, done: status.brandKeywords },
    { key: 'content', label: 'Create your first content item', hint: 'Draft it yourself or let Buzz draft it', href: '/content', done: status.hasContent },
    { key: 'agent', label: 'Run the first agent job', hint: 'Put a squad on the schedule', href: '/agents/squads', done: status.agentActive },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <div className="card card-hover p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="console-eyebrow mb-1.5">Get started</p>
          <h3 className="text-sm font-semibold text-foreground">
            {allDone ? 'Workspace fully set up 🎉' : `Set up your workspace — ${doneCount}/${steps.length}`}
          </h3>
        </div>
        <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden shrink-0" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={steps.length}>
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        {steps.map(step => (
          <Link
            key={step.key}
            href={step.href}
            className={`group flex items-center gap-3 py-2 px-2 -mx-2 rounded-md transition-colors ${step.done ? 'opacity-60' : 'hover:bg-surface-2/60'}`}
          >
            {step.done ? (
              <CheckCircle2 size={16} className="text-success shrink-0" />
            ) : (
              <Circle size={16} className="text-muted-foreground/50 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${step.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {step.label}
              </div>
              {!step.done && <div className="text-xs text-muted-foreground">{step.hint}</div>}
            </div>
            {!step.done && (
              <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ─── Buzz quick actions ────────────────────────────────── */

export function BuzzActionRow() {
  const actions = [
    { label: 'Draft today\u2019s post', prompt: 'Draft a post for today based on recent signals', icon: PenLine },
    { label: 'Summarize new signals', prompt: 'Summarize today\u2019s research signals', icon: Sparkles },
    { label: 'Plan a sequence', prompt: 'Help me plan an outreach sequence', icon: Send },
  ];

  const fire = (prompt: string) => {
    window.dispatchEvent(new CustomEvent('buzz:ask', { detail: { prompt } }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground mr-1">
        <Bot size={13} className="text-primary" /> Ask Buzz
      </span>
      {actions.map(({ label, prompt, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => fire(prompt)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-surface-1 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─── Needs attention strip ─────────────────────────────── */

export function NeedsAttention({ pending }: { pending: number }) {
  if (pending <= 0) return null;

  return (
    <Link
      href="/approvals"
      className="group flex items-center gap-3 px-4 py-3 rounded-lg border border-warning/30 bg-warning/5 hover:bg-warning/10 transition-colors"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-warning/15 text-warning shrink-0">
        <AlertTriangle size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {pending} {pending === 1 ? 'item needs' : 'items need'} your approval
        </p>
        <p className="text-xs text-muted-foreground">Content and outreach are waiting on you before anything goes out.</p>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary shrink-0">
        Review <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
      </span>
    </Link>
  );
}

/* ─── Going out today ───────────────────────────────────── */

interface ScheduledItem {
  id: string;
  text_preview: string;
  platform: string;
  scheduled_for: string | null;
}

export function GoingOutToday({ items }: { items: ScheduledItem[] }) {
  const now = new Date();
  const upcoming = items
    .filter(i => i.scheduled_for && new Date(i.scheduled_for) >= now && i.scheduled_for.slice(0, 10) <= new Date(now.getTime() + 48 * 3600 * 1000).toISOString().slice(0, 10))
    .sort((a, b) => (a.scheduled_for! < b.scheduled_for! ? -1 : 1))
    .slice(0, 3);

  return (
    <div className="card p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-heading flex items-center gap-1.5">
          <Clock size={13} /> Going out next
        </h3>
        <Link href="/content" className="text-xs font-semibold text-primary hover:underline">Calendar</Link>
      </div>

      {upcoming.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
          <p className="text-sm font-medium text-foreground mb-1">Nothing scheduled yet</p>
          <p className="text-xs text-muted-foreground max-w-[16rem] mb-3">
            Scheduled posts and emails will appear here as they line up.
          </p>
          <Link href="/content" className="btn btn-sm btn-primary">Plan content</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {upcoming.map(item => (
            <li key={item.id} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                {item.platform === 'email' ? <Mail size={13} /> : <PenLine size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground line-clamp-2">{item.text_preview || 'Untitled'}</p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                  {item.platform} · {new Date(item.scheduled_for!).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
