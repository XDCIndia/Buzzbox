'use client';

import {
  Search, Sun, Moon, Radio, PenLine, Mail, Users, LogOut,
  Bell, Eye, EyeOff, Check, CheckCheck, Boxes, Plus, Contact, Sparkles,
  ChevronDown, RefreshCw, RefreshCwOff, AlertTriangle,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/store';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';
import type { SyncHealth } from '@/lib/sync';
import { DEFAULT_BRAND_ID } from '@/lib/brand-constants';
import type { Notification } from '@/types';
import { BuzzAssistant } from '@/components/chat/buzz-assistant';

interface HeaderStats {
  posts_today: number;
  emails_sent: number;
  pipeline_count: number;
}

export function HeaderBar() {
  const { feedOpen, toggleFeed, realOnly, toggleRealOnly } = useDashboard();

  // Lightweight poll for header stats
  const { data: stats } = useSmartPoll<HeaderStats>(
    () => fetch(`/api/overview${realOnly ? '?real=true' : ''}`).then(r => r.json()).then(d => d.stats),
    { interval: 60_000, key: realOnly },
  );

  // Workspace context — always show which brand/workspace is being viewed
  const { data: brand } = useSmartPoll<{ name?: string }>(
    () => fetch(`/api/brand/${DEFAULT_BRAND_ID}`).then(r => (r.ok ? r.json() : null)),
    { interval: 120_000 },
  );
  const brandName = brand?.name || 'Workspace';

  return (
    <header className="fixed top-0 left-0 right-0 h-[var(--header-height)] bg-surface-0/90 backdrop-blur-md border-b border-border flex items-center justify-between px-3 sm:px-4 z-50">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-[var(--primary-foreground)]">
            <Boxes size={15} />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight text-foreground leading-none">Buzzbox</span>
            <span className="text-[10px] text-muted-foreground font-mono leading-none mt-0.5">Command Center</span>
          </div>
        </div>

        {/* Workspace context — which brand's data you are looking at */}
        <div className="hidden md:flex items-center gap-2 ml-1 pl-3 border-l border-border/60 min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Workspace</span>
          <span
            className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-border bg-surface-1 text-xs font-medium text-foreground max-w-[180px]"
            title={`Viewing data for: ${brandName}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success pulse-dot shrink-0" />
            <span className="truncate">{brandName}</span>
          </span>
        </div>

        {/* Quick stats — hidden on small screens */}
        {stats && (
          <div className="hidden xl:flex items-center gap-3 ml-1 pl-3 border-l border-border/50">
            <QuickStat icon={PenLine} value={stats.posts_today} label="posts" />
            <QuickStat icon={Mail} value={stats.emails_sent} label="sent" />
            <QuickStat icon={Users} value={stats.pipeline_count} label="pipeline" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5">
        <QuickCreateMenu />
        <DataStatusToggle active={realOnly} onToggle={toggleRealOnly} />
        <SearchTrigger />
        <ThemeToggle />
        <BuzzAssistant />
        <NotificationBell />
        <FeedToggle open={feedOpen} onToggle={toggleFeed} />
        <LogoutButton />
      </div>
    </header>
  );
}

const QUICK_CREATE_ITEMS = [
  { label: 'New content draft', hint: 'Write a post for any platform', href: '/content', icon: PenLine },
  { label: 'Add CRM lead', hint: 'Track a new contact', href: '/crm', icon: Contact },
  { label: 'Ask Buzz', hint: 'Draft, summarize, or plan with AI', buzzPrompt: 'Help me draft a post for today.', icon: Sparkles },
] as const;

function QuickCreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="h-7 flex items-center gap-1 pl-2 pr-1.5 rounded-lg bg-primary text-[var(--primary-foreground)] hover:opacity-90 transition-all text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Quick create"
        title="Quick create"
      >
        <Plus size={14} />
        <span className="hidden lg:inline">New</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 card border shadow-xl animate-in overflow-hidden z-50"
        >
          <div className="px-3 py-2 border-b border-border bg-surface-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-mono">Quick create</span>
          </div>
          <div className="p-1.5">
            {QUICK_CREATE_ITEMS.map(item => {
              const Icon = item.icon;
              return (
              <button
                key={item.label}
                role="menuitem"
                className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-surface-2 transition-colors focus:outline-none focus:bg-surface-2"
                onClick={() => {
                  setOpen(false);
                  if ('buzzPrompt' in item && item.buzzPrompt) {
                    window.dispatchEvent(new CustomEvent('buzz:ask', { detail: { prompt: item.buzzPrompt } }));
                  } else if ('href' in item && item.href) {
                    window.location.href = item.href;
                  }
                }}
              >
                <span className="mt-0.5 w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon size={13} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground">{item.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
                </span>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Combined data-mode + sync status popover (replaces SeedToggle + SyncStatus pair).
 * The sync line reflects real sync state from /api/settings -- wall-clock time is
 * never presented as a sync event (#69). */
function DataStatusToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: syncHealth } = useSmartPoll<SyncHealth>(
    () => fetch('/api/settings').then(r => (r.ok ? r.json() : null)).then(d => d?.sync_health ?? null),
    { interval: 30_000 },
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className={`hidden md:flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
          active
            ? 'bg-success/15 text-success border border-success/30'
            : 'bg-surface-1 text-muted-foreground hover:text-foreground border border-border'
        }`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Data mode and sync status"
        title="Data mode & sync"
      >
        {active ? <Eye size={13} /> : <EyeOff size={13} />}
        <SyncBadge health={syncHealth ?? null} />
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 card border shadow-xl animate-in overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-border bg-surface-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-mono">Data status</span>
          </div>
          <div className="p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-foreground">{active ? 'Real data only' : 'All data'}</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {active ? 'Seeded/demo entries are hidden.' : 'Seeded demo entries are shown alongside real data.'}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={active}
                aria-label="Toggle real data only"
                onClick={onToggle}
                className={`relative w-8 h-4.5 shrink-0 rounded-full transition-colors mt-0.5 ${active ? 'bg-success' : 'bg-muted-foreground/30'}`}
                style={{ height: 18 }}
              >
                <span
                  className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all"
                  style={{ left: active ? 16 : 2 }}
                />
              </button>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border/60 text-[11px] text-muted-foreground">
              <SyncStatusLine health={syncHealth ?? null} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncBadge({ health }: { health: SyncHealth | null }) {
  if (!health?.last_sync_at) {
    return <RefreshCwOff size={13} className="opacity-60" />;
  }
  return health.last_sync_status === 'ok' ? (
    <RefreshCw size={13} />
  ) : (
    <AlertTriangle size={13} />
  );
}

function SyncStatusLine({ health }: { health: SyncHealth | null }) {
  if (!health?.last_sync_at) {
    return (
      <span className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
        Not yet synchronized
      </span>
    );
  }
  if (health.last_sync_status === 'error') {
    return (
      <span className="flex items-center gap-2 text-destructive" title={health.last_sync_error ?? undefined}>
        <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
        Sync failed
        <span className="ml-auto font-mono text-foreground">{timeAgo(health.last_sync_at)}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-success shrink-0" />
      Synced <span className="font-mono text-foreground">{timeAgo(health.last_sync_at)}</span>
      {health.last_sync_duration_ms != null && (
        <span className="ml-auto font-mono">{health.last_sync_duration_ms}ms</span>
      )}
    </span>
  );
}

function QuickStat({ icon: Icon, value, label }: { icon: typeof PenLine; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Icon size={11} />
      <span className="font-mono font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const realOnly = useDashboard(s => s.realOnly);

  const { data: notifications, refetch } = useSmartPoll<Notification[]>(
    () => fetch(`/api/notifications?limit=20${realOnly ? '&real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  const unreadCount = notifications?.filter(n => !n.read).length ?? 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function markRead(id: number) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    refetch();
  }

  async function markAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_all_read: true }),
    });
    refetch();
  }

  const SEVERITY_COLORS = {
    info: 'text-info',
    warning: 'text-warning',
    error: 'text-destructive',
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all relative focus:outline-none focus:ring-2 focus:ring-primary ${
          open ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-surface-1 hover:bg-surface-2 border border-border text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 card border shadow-xl max-h-96 overflow-hidden flex flex-col animate-in z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium focus:outline-none focus:ring-1 focus:ring-primary rounded"
              >
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {(!notifications || notifications.length === 0) ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Bell size={24} className="mx-auto mb-2 opacity-30 text-muted-foreground" />
                No notifications yet
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-border/40 hover:bg-surface-2/60 transition-colors ${
                    !n.read ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`mt-0.5 ${SEVERITY_COLORS[n.severity] || 'text-muted-foreground'}`}>
                      <Bell size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {n.title && (
                        <div className="text-xs font-semibold truncate text-foreground">{n.title}</div>
                      )}
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-muted-foreground font-mono">{timeAgo(n.created_at)}</span>
                        {!n.read && (
                          <button
                            onClick={() => markRead(n.id)}
                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5 font-medium"
                          >
                            <Check size={10} /> Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchTrigger() {
  return (
    <button
      className="hidden md:flex items-center gap-2 h-7 px-2.5 rounded-lg bg-surface-1 hover:bg-surface-2 border border-border text-xs text-muted-foreground hover:text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary"
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
      aria-label="Search application"
    >
      <Search size={13} />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden sm:inline text-[10px] font-mono bg-surface-2 border border-border px-1.5 py-0.5 rounded text-muted-foreground ml-1">⌘K</kbd>
    </button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const currentTheme = theme === 'dark' ? 'dark' : 'light';

  return (
    <button
      className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface-1 hover:bg-surface-2 border border-border text-muted-foreground hover:text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary"
      onClick={() => setTheme(currentTheme === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {currentTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

function FeedToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
        open
          ? 'bg-primary/15 text-primary border border-primary/30'
          : 'bg-surface-1 hover:bg-surface-2 border border-border text-muted-foreground hover:text-foreground'
      }`}
      onClick={onToggle}
      aria-label="Toggle live feed panel"
      title="Toggle live feed"
    >
      <Radio size={14} />
    </button>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface-1 hover:bg-surface-2 border border-border text-muted-foreground hover:text-destructive transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
      onClick={handleLogout}
      disabled={loading}
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut size={14} />
    </button>
  );
}
