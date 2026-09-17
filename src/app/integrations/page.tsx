'use client';

import { useSmartPoll } from '@/hooks/use-smart-poll';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/utils';

interface IntegrationCard {
  enabled: boolean;
  ok?: boolean;
  error?: string;
  checked_at?: string;
}

interface GAHealth extends IntegrationCard {
  id?: string | null;
}

interface SanityStatus extends IntegrationCard {
  count?: number;
  items?: { id: string; title: string; type?: string; updatedAt?: string | null; publishedAt?: string | null; slug?: string | null }[];
}

interface MailchimpStatus extends IntegrationCard {
  count?: number;
  totals?: { members: number; unsubscribed: number; cleaned: number };
  lists?: { id: string; name: string; members: number; unsubscribed?: number; cleaned?: number }[];
}

interface GmailStatus extends IntegrationCard {
  messages?: number;
  unseen?: number;
}

interface HeliusStatus extends IntegrationCard {
  health?: string | null;
  slot?: number | null;
}

function StatusPill({ ok }: { ok?: boolean }) {
  return (
    <span className={ok ? 'status-pill status-ok' : 'status-pill status-warn'}>
      {ok ? 'OK' : 'Check'}
    </span>
  );
}

export default function IntegrationsPage() {
  const { data: gaHealth } = useSmartPoll<GAHealth>(() => fetch('/api/health/ga').then(r => r.json()), { interval: 60_000 });
  const { data: sanity } = useSmartPoll<SanityStatus>(() => fetch('/api/integrations/sanity').then(r => r.json()), { interval: 60_000 });
  const { data: mailchimp } = useSmartPoll<MailchimpStatus>(() => fetch('/api/integrations/mailchimp').then(r => r.json()), { interval: 60_000 });
  const { data: gmail } = useSmartPoll<GmailStatus>(() => fetch('/api/integrations/gmail').then(r => r.json()), { interval: 60_000 });
  const { data: helius } = useSmartPoll<HeliusStatus>(() => fetch('/api/integrations/helius').then(r => r.json()), { interval: 60_000 });

  return (
    <div className="space-y-6 animate-in">
      <PageHeader
        index="12"
        eyebrow="System"
        title="Integrations"
        description="Live status for Hermes data sources"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 space-y-2">
          <div className="text-xs text-muted-foreground">Google Analytics</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{gaHealth?.enabled ? 'Enabled' : 'Disabled'}</div>
              <div className="text-[11px] text-muted-foreground">{gaHealth?.id || 'No GA ID configured'}</div>
            </div>
            <StatusPill ok={gaHealth?.enabled} />
          </div>
          <div className="text-[10px] text-muted-foreground">Last check: {gaHealth?.checked_at ? new Date(gaHealth.checked_at).toLocaleTimeString() : '—'}</div>
        </div>

        <div className="panel p-4 space-y-2">
          <div className="text-xs text-muted-foreground">Sanity</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{sanity?.enabled ? (sanity.ok ? 'Connected' : 'Error') : 'Disabled'}</div>
              <div className="text-[11px] text-muted-foreground">{sanity?.count ?? 0} items</div>
            </div>
            <StatusPill ok={sanity?.ok} />
          </div>
          {sanity?.error && <div className="text-[11px] text-destructive">{sanity.error}</div>}
          <div className="text-[10px] text-muted-foreground">Latest: {sanity?.items?.[0]?.title || '—'}</div>
        </div>

        <div className="panel p-4 space-y-2">
          <div className="text-xs text-muted-foreground">Mailchimp</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{mailchimp?.enabled ? (mailchimp.ok ? 'Connected' : 'Error') : 'Disabled'}</div>
              <div className="text-[11px] text-muted-foreground">Members: {mailchimp?.totals?.members ?? 0}</div>
            </div>
            <StatusPill ok={mailchimp?.ok} />
          </div>
          {mailchimp?.error && <div className="text-[11px] text-destructive">{mailchimp.error}</div>}
          <div className="text-[10px] text-muted-foreground">Lists: {mailchimp?.count ?? 0}</div>
        </div>

        <div className="panel p-4 space-y-2">
          <div className="text-xs text-muted-foreground">Gmail</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{gmail?.enabled ? (gmail.ok ? 'Connected' : 'Error') : 'Disabled'}</div>
              <div className="text-[11px] text-muted-foreground">Unread: {gmail?.unseen ?? 0}</div>
            </div>
            <StatusPill ok={gmail?.ok} />
          </div>
          {gmail?.error && <div className="text-[11px] text-destructive">{gmail.error}</div>}
          <div className="text-[10px] text-muted-foreground">Messages: {gmail?.messages ?? 0}</div>
        </div>

        <div className="panel p-4 space-y-2">
          <div className="text-xs text-muted-foreground">Helius</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{helius?.enabled ? (helius.ok ? 'Healthy' : 'Error') : 'Disabled'}</div>
              <div className="text-[11px] text-muted-foreground">Slot: {helius?.slot ?? '—'}</div>
            </div>
            <StatusPill ok={helius?.ok} />
          </div>
          {helius?.error && <div className="text-[11px] text-destructive">{helius.error}</div>}
          <div className="text-[10px] text-muted-foreground">Health: {helius?.health ?? '—'}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="section-title">Recent Sanity Items</h2>
        </div>
        <div className="panel-body">
          {sanity?.items?.length ? (
            <div className="space-y-2 text-xs">
              {sanity.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2">
                  <div>
                    <div className="font-medium">{item.title}</div>
                    <div className="text-muted-foreground">{item.type || 'content'}{item.slug ? ` · ${item.slug}` : ''}</div>
                  </div>
                  <div className="text-right text-muted-foreground whitespace-nowrap">
                    {formatDateTime(item.updatedAt || item.publishedAt || null)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No Sanity items found.</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="section-title">Mailchimp Lists</h2>
        </div>
        <div className="panel-body">
          {mailchimp?.lists?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {mailchimp.lists.map((list) => (
                <div key={list.id} className="p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="font-medium">{list.name}</div>
                  <div className="text-muted-foreground">Members: {list.members}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No Mailchimp lists found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
