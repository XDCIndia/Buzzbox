'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Gauge, Bot, PenLine, MessageCircle, Mail, Contact, Zap,
  Search, BarChart3, LineChart, BrainCircuit, Rocket, Clock, List, Settings,
  FolderOpen, AtSign, Newspaper, PieChart, Megaphone, Sparkles, Bell,
  CheckSquare, Plug,
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
  /** Small uppercase header rendered above this item when it differs from the previous item's. Used to cluster a flat group into visual sub-sections without a second nesting level. */
  subLabel?: string;
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
      { href: `/brand/${DEFAULT_BRAND_ID}/overview`, label: 'Overview', icon: Gauge },
      { href: `/brand/${DEFAULT_BRAND_ID}/mentions/social`, label: 'Social Media', icon: AtSign, subLabel: 'Mentions' },
      { href: `/brand/${DEFAULT_BRAND_ID}/mentions/news`, label: 'News Media', icon: Newspaper, subLabel: 'Mentions' },
      { href: `/brand/${DEFAULT_BRAND_ID}/analyze/social`, label: 'Social Analytics', icon: PieChart, subLabel: 'Analyze' },
      { href: `/brand/${DEFAULT_BRAND_ID}/create/campaigns`, label: 'Campaigns', icon: Megaphone, subLabel: 'Create' },
      { href: `/brand/${DEFAULT_BRAND_ID}/create/digests`, label: 'AI Digests', icon: Sparkles, subLabel: 'Create' },
      { href: `/brand/${DEFAULT_BRAND_ID}/create/alerts`, label: 'Alerts', icon: Bell, subLabel: 'Create' },
    ],
  },
  {
    label: 'OPERATE',
    items: [
      { href: '/content', label: 'Content', icon: PenLine, countKey: 'content' },
      { href: '/approvals', label: 'Approvals', icon: CheckSquare, countKey: 'total_pending' },
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
      { href: '/integrations', label: 'Integrations', icon: Plug },
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
    <nav className="nav-rail fixed left-0 top-[var(--header-height)] bottom-0 w-[var(--nav-width)] bg-surface-0/95 backdrop-blur-md border-r border-border z-40 hidden md:flex flex-col select-none">
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.label} className={idx > 0 ? 'pt-4 border-t border-border/40' : ''}>
            <div className="px-2.5 pb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/60">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item, itemIdx) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                const count = item.countKey && counts ? counts[item.countKey] : 0;
                const Icon = item.icon;
                const showSubLabel = item.subLabel && item.subLabel !== group.items[itemIdx - 1]?.subLabel;
                return (
                  <div key={item.href}>
                    {showSubLabel && (
                      <div className="px-2.5 pt-2 pb-0.5 text-[9px] uppercase font-semibold tracking-wider text-muted-foreground/50">
                        {item.subLabel}
                      </div>
                    )}
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      aria-label={item.label}
                      className={`group relative w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                        active
                          ? 'bg-primary/12 text-primary font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/70 font-medium'
                      }`}
                    >
                      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-primary rounded-r-full shadow-sm" />}
                      <Icon size={15} className={active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {count > 0 && (
                        <span className={`min-w-[18px] h-4 px-1 text-[9px] font-bold rounded-full flex items-center justify-center ${
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
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-2.5 border-t border-border/60 bg-surface-1/40">
        <Link
          href="/settings"
          aria-current={pathname === '/settings' ? 'page' : undefined}
          aria-label="Settings"
          className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
            pathname === '/settings'
              ? 'bg-primary/12 text-primary font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/70'
          }`}
        >
          {pathname === '/settings' && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-primary rounded-r-full shadow-sm" />}
          <Settings size={15} className={pathname === '/settings' ? 'text-primary' : 'text-muted-foreground'} />
          <span>Settings</span>
        </Link>
      </div>
    </nav>
  );
}
