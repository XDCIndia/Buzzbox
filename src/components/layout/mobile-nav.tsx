'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Gauge, Bot, Mail, Contact, MoreHorizontal,
  PenLine, MessageCircle, Zap, FlaskConical, Search,
  BarChart3, LineChart, BrainCircuit, Rocket, Clock, List, Settings,
  FolderOpen, AtSign, Newspaper, PieChart, Megaphone, Sparkles, Bell,
  CheckSquare, Plug, X,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { DEFAULT_BRAND_ID } from '@/lib/brand-constants';

interface NavCounts {
  content: number;
  outreach: number;
  signals_today: number;
  new_leads: number;
  total_pending: number;
}

type CountKey = keyof NavCounts;

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  countKey?: CountKey;
  priority?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { href: '/', label: 'Overview', icon: Gauge, priority: true },
      { href: '/agents/squads', label: 'Squads', icon: Bot, priority: true },
      { href: '/outreach', label: 'Outreach', icon: Mail, countKey: 'outreach', priority: true },
      { href: '/crm', label: 'CRM', icon: Contact, countKey: 'new_leads', priority: true },
    ],
  },
  {
    label: 'Brand',
    items: [
      { href: `/brand/${DEFAULT_BRAND_ID}/overview`, label: 'Brand Overview', icon: Gauge },
      { href: `/brand/${DEFAULT_BRAND_ID}/mentions/social`, label: 'Social Mentions', icon: AtSign },
      { href: `/brand/${DEFAULT_BRAND_ID}/mentions/news`, label: 'News Mentions', icon: Newspaper },
      { href: `/brand/${DEFAULT_BRAND_ID}/analyze/social`, label: 'Social Analytics', icon: PieChart },
      { href: `/brand/${DEFAULT_BRAND_ID}/create/campaigns`, label: 'Campaigns', icon: Megaphone },
      { href: `/brand/${DEFAULT_BRAND_ID}/create/digests`, label: 'AI Digests', icon: Sparkles },
      { href: `/brand/${DEFAULT_BRAND_ID}/create/alerts`, label: 'Alerts', icon: Bell },
    ],
  },
  {
    label: 'Operate',
    items: [
      { href: '/agents/comms', label: 'Comms', icon: MessageCircle },
      { href: '/agents/workspace', label: 'Workspace', icon: FolderOpen },
      { href: '/content', label: 'Content', icon: PenLine, countKey: 'content' },
      { href: '/approvals', label: 'Approvals', icon: CheckSquare, countKey: 'total_pending' },
      { href: '/engagement', label: 'Engagement', icon: MessageCircle },
      { href: '/automations', label: 'Automations', icon: Zap, countKey: 'outreach' },
      { href: '/experiments', label: 'Experiments', icon: FlaskConical },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/research', label: 'Research', icon: Search, countKey: 'signals_today' },
      { href: '/kpis', label: 'KPIs', icon: BarChart3 },
      { href: '/analytics', label: 'Analytics', icon: LineChart },
      { href: '/integrations', label: 'Integrations', icon: Plug },
      { href: '/memory', label: 'Memory', icon: BrainCircuit },
      { href: '/deploy', label: 'Deploy', icon: Rocket },
      { href: '/cron', label: 'Cron', icon: Clock },
      { href: '/activity', label: 'Activity', icon: List },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function MobileNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const realOnly = useDashboard(s => s.realOnly);

  const { data: counts } = useSmartPoll<NavCounts>(
    () => fetch(`/api/counts${realOnly ? '?real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  const priorityItems = useMemo(
    () => NAV_GROUPS.flatMap(g => g.items).filter(i => i.priority),
    [],
  );
  const nonPriorityItems = useMemo(
    () => NAV_GROUPS.flatMap(g => g.items).filter(i => !i.priority),
    [],
  );
  const sheetGroups = useMemo(
    () => NAV_GROUPS
      .map(group => ({ ...group, items: group.items.filter(i => !i.priority) }))
      .filter(group => group.items.length > 0),
    [],
  );
  const moreActive = nonPriorityItems.some(i => isActive(pathname, i.href));
  const moreBadge = counts ? (counts.content + counts.total_pending) : 0;

  useEffect(() => {
    if (!sheetOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setSheetOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [sheetOpen]);

  return (
    <>
      <nav aria-label="Mobile Bottom Navigation" className="mobile-nav md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg z-50 border-t border-border safe-area-bottom select-none">
        <div className="flex items-center justify-around h-14 px-1 pb-[env(safe-area-inset-bottom)]">
          {priorityItems.map((item) => {
            const active = isActive(pathname, item.href);
            const count = item.countKey && counts ? counts[item.countKey] : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-xl min-w-[48px] min-h-[48px] transition-all relative ${
                  active ? 'text-primary font-semibold' : 'text-muted-foreground'
                }`}
              >
                <Icon size={18} />
                <span className="text-[10px] leading-none font-medium">{item.label}</span>
                {count > 0 && (
                  <span className="absolute top-1 right-1 min-w-[15px] h-3.5 px-1 text-[8px] font-bold rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            );
          })}

          <button
            onClick={() => setSheetOpen(true)}
            aria-expanded={sheetOpen}
            aria-label="Open full menu drawer"
            className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-xl min-w-[48px] min-h-[48px] transition-all relative ${
              moreActive || sheetOpen ? 'text-primary font-semibold' : 'text-muted-foreground'
            }`}
          >
            <MoreHorizontal size={18} />
            <span className="text-[10px] leading-none font-medium">More</span>
            {moreBadge > 0 && (
              <span className="absolute top-1 right-1 min-w-[15px] h-3.5 px-1 text-[8px] font-bold rounded-full bg-warning text-warning-foreground flex items-center justify-center shadow-sm">
                {moreBadge > 99 ? '99+' : moreBadge}
              </span>
            )}
          </button>
        </div>
      </nav>

      {sheetOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Navigation Menu">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setSheetOpen(false)} />
          <div
            ref={sheetRef}
            className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl max-h-[78vh] overflow-y-auto safe-area-bottom border-t border-border shadow-2xl animate-in"
          >
            <div className="sticky top-0 bg-card/95 backdrop-blur-md pt-3 pb-2 px-4 border-b border-border/50 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Navigation Menu</span>
              </div>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close menu"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface-1 border border-border text-muted-foreground hover:text-foreground"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {sheetGroups.map((group, idx) => (
                <div key={group.label} className={idx > 0 ? 'pt-3 border-t border-border/40' : ''}>
                  <div className="px-1 pb-2 text-[10px] uppercase font-bold tracking-widest text-muted-foreground/70">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      const count = item.countKey && counts ? counts[item.countKey] : 0;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setSheetOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className={`flex items-center gap-2.5 px-3 min-h-[48px] rounded-xl transition-all relative border ${
                            active
                              ? 'bg-primary/12 border-primary/30 text-primary font-semibold'
                              : 'bg-surface-1/60 border-border/50 text-foreground hover:bg-surface-2'
                          }`}
                        >
                          <Icon size={16} className={active ? 'text-primary' : 'text-muted-foreground'} />
                          <span className="text-xs font-medium truncate flex-1">{item.label}</span>
                          {count > 0 && (
                            <span className={`min-w-[16px] h-4 px-1 text-[8px] font-bold rounded-full flex items-center justify-center ${
                              item.countKey === 'total_pending'
                                ? 'bg-warning/20 text-warning border border-warning/30'
                                : item.countKey === 'signals_today'
                                ? 'bg-info/20 text-info border border-info/30'
                                : 'bg-primary/20 text-primary border border-primary/30'
                            }`}>
                              {count > 99 ? '99+' : count}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
