'use client';

import {
  Activity, Search, Sun, Moon, Radio, PenLine, Mail, Users, LogOut,
  Bell, Eye, EyeOff, Check, CheckCheck, Bot,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/store';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';
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

  return (
    <header className="fixed top-0 left-0 right-0 h-[var(--header-height)] bg-surface-0/90 backdrop-blur-md border-b border-border flex items-center justify-between px-3 sm:px-4 z-50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center text-primary">
            <Bot size={15} />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight text-foreground leading-none">Buzzbox</span>
            <span className="text-[10px] text-muted-foreground font-mono leading-none mt-0.5">Command Center</span>
          </div>
        </div>

        {/* Quick stats — hidden on small screens */}
        {stats && (
          <div className="hidden lg:flex items-center gap-3 ml-3 pl-3 border-l border-border/50">
            <QuickStat icon={PenLine} value={stats.posts_today} label="posts" />
            <QuickStat icon={Mail} value={stats.emails_sent} label="sent" />
            <QuickStat icon={Users} value={stats.pipeline_count} label="pipeline" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5">
        <SeedToggle active={realOnly} onToggle={toggleRealOnly} />
        <SearchTrigger />
        <ThemeToggle />
        <BuzzAssistant />
        <NotificationBell />
        <FeedToggle open={feedOpen} onToggle={toggleFeed} />
        <SyncStatus />
        <LogoutButton />
      </div>
    </header>
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

function SeedToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      className={`h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
        active
          ? 'bg-success/15 text-success border border-success/30'
          : 'bg-surface-1 text-muted-foreground hover:text-foreground border border-border'
      }`}
      onClick={onToggle}
      aria-label={active ? 'Showing real data only' : 'Showing all data including seeded'}
      title={active ? 'Showing real data only' : 'Showing all data (including seeded)'}
    >
      {active ? <Eye size={13} /> : <EyeOff size={13} />}
      <span className="hidden sm:inline">{active ? 'Real' : 'All Data'}</span>
    </button>
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

function SyncStatus() {
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground bg-surface-1 px-2.5 py-1 rounded-lg border border-border">
      <div className="w-2 h-2 rounded-full bg-success pulse-dot" />
      <Activity size={12} className="text-muted-foreground" />
      <span className="font-mono">{lastSync}</span>
    </div>
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
