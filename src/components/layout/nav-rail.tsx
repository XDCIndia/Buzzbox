'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Gauge, Bot, PenLine, MessageCircle, Mail, Contact, Zap,
  Search, BarChart3, LineChart, BrainCircuit, Rocket, Clock, List, Settings,
  FolderOpen, AtSign,
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
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'CORE',
    items: [
      { href: '/', label: 'Overview', icon: Gauge },
      { href: '/agents/squads', label: 'Squads', icon: Bot },
      { href: '/agents/comms', label: 'Comms', icon: MessageCircle },
      { href: '/agents/workspace', label: 'Workspace', icon: FolderOpen },
    ],
  },
  {
    label: 'BRAND',
    items: [
      { href: `/brand/${DEFAULT_BRAND_ID}`, label: 'Brand Mentions', icon: AtSign },
    ],
  },
  {
    label: 'OPERATE',
    items: [
      { href: '/content', label: 'Content', icon: PenLine, countKey: 'content' },
      { href: '/engagement', label: 'Engagement', icon: MessageCircle },
      { href: '/outreach', label: 'Outreach', icon: Mail, countKey: 'outreach' },
      { href: '/crm', label: 'CRM', icon: Contact, countKey: 'new_leads' },
      { href: '/automations', label: 'Automations', icon: Zap, countKey: 'outreach' },
    ],
  },
  {
    label: 'OBSERVE',
    items: [
      { href: '/research', label: 'Research', icon: Search, countKey: 'signals_today' },
      { href: '/kpis', label: 'KPIs', icon: BarChart3 },
      { href: '/analytics', label: 'Analytics', icon: LineChart },
      { href: '/memory', label: 'Memory', icon: BrainCircuit },
      { href: '/deploy', label: 'Deploy', icon: Rocket },
      { href: '/cron', label: 'Cron', icon: Clock },
      { href: '/activity', label: 'Activity', icon: List },
    ],
  },
];

export function NavRail() {
  const pathname = usePathname();
  const realOnly = useDashboard(s => s.realOnly);

  const { data: counts } = useSmartPoll<NavCounts>(
    () => fetch(`/api/counts${realOnly ? '?real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  return (
    <nav className="nav-rail fixed left-0 top-[var(--header-height)] bottom-0 w-[var(--nav-width)] bg-card/92 backdrop-blur-lg border-r border-border/70 z-40 hidden md:flex flex-col">
      <div className="px-3 py-3 border-b border-border/60 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
          H
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-none">Hermes</div>
          <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">Mission View</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.label} className={idx > 0 ? 'mt-3 pt-3 border-t border-border/50' : ''}>
            <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                const count = item.countKey && counts ? counts[item.countKey] : 0;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-smooth ${
                      active
                        ? 'bg-primary/14 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/80'
                    }`}
                  >
                    {active && <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />}
                    <Icon size={16} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <span className={`min-w-[18px] h-4 px-1 text-[9px] font-bold rounded-full flex items-center justify-center ${
                        item.countKey === 'signals_today' ? 'count-badge-info' : 'count-badge'
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

      <div className="px-2 py-2 border-t border-border/60">
        <Link
          href="/settings"
          className={`relative w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-smooth ${
            pathname === '/settings'
              ? 'bg-primary/14 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/80'
          }`}
        >
          {pathname === '/settings' && <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />}
          <Settings size={16} />
          <span>Settings</span>
        </Link>
      </div>
    </nav>
  );
}
