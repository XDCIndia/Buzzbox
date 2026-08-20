"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Globe,
  LineChart,
  MousePointerClick,
  Users,
  Send,
  Linkedin,
  X,
  Monitor,
  Smartphone,
  Tablet,
  MapPin,
  FileText,
  UserPlus,
  UserCheck,
} from "lucide-react";
import { useSmartPoll } from "@/hooks/use-smart-poll";
import { useDashboard } from "@/store";
import { StatCard } from "@/components/ui/stat-card";
import { TrendChart } from "@/components/ui/trend-chart";
import { DataTable } from "@/components/ui/data-table";
import { ChartSkeleton } from "@/components/ui/loading-skeleton";
import { ProviderConfigCard } from "@/components/ui/provider-config-card";
import type { SocialAnalyticsPoint, SocialAnalyticsSummary } from "@/lib/analytics";
import { formatDurationSeconds } from "@/lib/analytics";
import { timeAgo } from "@/lib/utils";
import type {
  Ga4TopPage,
  Ga4TrafficSource,
  Ga4DeviceSplit,
  Ga4NewVsReturning,
  Ga4GeoEntry,
} from "@/lib/ga4";

interface Ga4Summary {
  activeUsers: number;
  sessions: number;
  pageviews: number;
  bounceRatePct?: number;
  avgSessionDurationSeconds?: number;
}

interface Ga4SeriesPoint {
  date: string;
  activeUsers: number;
  sessions: number;
  pageviews: number;
}

interface PlausibleWebsiteSummary {
  visitors: number;
  pageviews: number;
  bounceRatePct: number;
  visitDurationSeconds: number;
}

interface PlausibleSeriesPoint {
  date: string;
  visitors: number;
  pageviews: number;
}

interface ProviderHealth {
  latency_ms?: number;
  attempts?: number;
  retry_count?: number;
  last_success_at?: string;
  last_error_at?: string;
  stale_after_seconds?: number;
  next_retry_after_seconds?: number;
}

type WebsitePayload =
  | {
      provider: "ga4";
      configured: boolean;
      summary?: Ga4Summary;
      series?: Ga4SeriesPoint[];
      topPages?: Ga4TopPage[];
      trafficSources?: Ga4TrafficSource[];
      deviceSplit?: Ga4DeviceSplit[];
      newVsReturning?: Ga4NewVsReturning[];
      countries?: Ga4GeoEntry[];
      error?: string;
      iframeUrl?: string;
      health?: ProviderHealth;
    }
  | {
      provider: "plausible";
      configured: boolean;
      summary?: PlausibleWebsiteSummary;
      series?: PlausibleSeriesPoint[];
      error?: string;
      iframeUrl?: string;
      health?: ProviderHealth;
    }
  | { provider: "iframe"; configured: boolean; iframeUrl: string; health?: ProviderHealth }
  | { provider: "none"; configured: false; error?: string; iframeUrl?: string; health?: ProviderHealth };

interface AnalyticsPayload {
  days: number;
  website: WebsitePayload;
  x: {
    provider: "x";
    configured: boolean;
    summary?: {
      username: string;
      followers: number;
      following?: number;
      postsInRange: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
    };
    series?: { date: string; posts: number; likes: number; replies: number; reposts: number; quotes: number }[];
    error?: string;
    health?: ProviderHealth;
  };
  linkedin: {
    provider: "linkedin";
    configured: boolean;
    summary?: {
      organizationUrn: string;
      followers?: number;
      impressions?: number;
      clicks?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      engagementRatePct?: number;
    };
    series?: { date: string; impressions: number; clicks: number; likes: number; comments: number; shares: number }[];
    error?: string;
    health?: ProviderHealth;
  };
  social: {
    provider: "internal";
    configured: boolean;
    summary: SocialAnalyticsSummary;
    series: SocialAnalyticsPoint[];
    iframeUrl?: string | null;
  };
}

export default function AnalyticsPage() {
  const { realOnly } = useDashboard();
  const [days, setDays] = useState(30);

  const url = `/api/analytics?days=${days}${realOnly ? "&real=true" : ""}`;
  const { data, loading } = useSmartPoll<AnalyticsPayload>(
    () => fetch(url).then((r) => r.json()),
    { interval: 300_000, key: `${days}-${realOnly}` },
  );

  const socialSeries = useMemo(() => data?.social?.series ?? [], [data]);

  if (!data || loading) {
    return (
      <div className="space-y-6 animate-in">
        <div className="panel">
          <div className="panel-header flex items-center justify-between">
            <h1 className="text-xl font-semibold">Analytics</h1>
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <ChartSkeleton height={240} />
          <ChartSkeleton height={240} />
          <ChartSkeleton height={240} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="panel">
        <div className="panel-header flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <LineChart size={18} className="text-primary" />
            <h1 className="text-xl font-semibold">Analytics</h1>
          </div>
          <div className="flex items-center gap-1">
            <RangeButton active={days === 7} onClick={() => setDays(7)} label="7d" />
            <RangeButton active={days === 30} onClick={() => setDays(30)} label="30d" />
            <RangeButton active={days === 90} onClick={() => setDays(90)} label="90d" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <WebsitePanel website={data.website} />
        <XPanel x={data.x} days={data.days} />
        <LinkedInPanel linkedin={data.linkedin} days={data.days} />
      </div>

      <SocialPanel social={data.social} series={socialSeries} />
    </div>
  );
}

function ProviderHealthHint({
  health,
  compact = false,
}: {
  health?: ProviderHealth;
  compact?: boolean;
}) {
  if (!health) return null;
  const parts: string[] = [];
  if (typeof health.latency_ms === "number") parts.push(`${health.latency_ms}ms`);
  if (typeof health.retry_count === "number") parts.push(`retries ${health.retry_count}`);
  if (health.last_success_at) parts.push(`ok ${timeAgo(health.last_success_at)}`);
  if (health.last_error_at) parts.push(`error ${timeAgo(health.last_error_at)}`);
  if (parts.length === 0) return null;

  return (
    <div className={`text-[10px] text-muted-foreground ${compact ? "" : "mt-1"}`}>
      {parts.join(" · ")}
    </div>
  );
}

function RangeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors border ${
        active
          ? "bg-primary/15 text-primary border-primary/30"
          : "bg-muted/50 text-muted-foreground hover:bg-muted border-border/30"
      }`}
    >
      {label}
    </button>
  );
}

/* ─── Traffic Sources Bar ─────────────────────── */

function TrafficSourcesSection({ sources }: { sources: Ga4TrafficSource[] }) {
  const total = sources.reduce((s, c) => s + c.sessions, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="section-title text-xs flex items-center gap-1.5">
        <Activity size={12} />
        Traffic Sources
      </h4>
      <div className="space-y-1.5">
        {sources.map((s) => {
          const pct = total > 0 ? (s.sessions / total) * 100 : 0;
          return (
            <div key={s.channel} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-muted-foreground">{s.channel}</span>
              <div className="flex-1 h-4 bg-muted/50 rounded-sm overflow-hidden relative">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${Math.max(pct, 1)}%`,
                    background: "var(--primary)",
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className="w-10 text-right font-mono text-muted-foreground">{pct.toFixed(0)}%</span>
              <span className="w-12 text-right font-mono">{s.sessions.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Top Pages Table ─────────────────────────── */

function TopPagesSection({ pages }: { pages: Ga4TopPage[] }) {
  const columns = [
    {
      key: "pagePath",
      label: "Page",
      sortable: true,
      render: (row: Ga4TopPage) => (
        <div className="max-w-[200px]">
          <div className="font-mono text-[11px] truncate">{row.pagePath}</div>
          <div className="text-[10px] text-muted-foreground truncate">{row.pageTitle}</div>
        </div>
      ),
    },
    { key: "pageviews", label: "Views", sortable: true },
    { key: "activeUsers", label: "Users", sortable: true },
  ];

  return (
    <div className="space-y-2">
      <h4 className="section-title text-xs flex items-center gap-1.5">
        <FileText size={12} />
        Top Pages
      </h4>
      <DataTable columns={columns} data={pages} keyField="pagePath" emptyMessage="No page data" />
    </div>
  );
}

/* ─── Device Split ────────────────────────────── */

const DEVICE_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

function DeviceSplitSection({ devices }: { devices: Ga4DeviceSplit[] }) {
  return (
    <div className="space-y-2">
      <h4 className="section-title text-xs flex items-center gap-1.5">
        <Monitor size={12} />
        Devices
      </h4>
      <div className="grid grid-cols-3 gap-2">
        {devices.map((d) => {
          const Icon = DEVICE_ICONS[d.device.toLowerCase()] || Monitor;
          return (
            <StatCard
              key={d.device}
              label={d.device.charAt(0).toUpperCase() + d.device.slice(1)}
              value={d.activeUsers}
              icon={Icon}
              color="var(--info)"
            />
          );
        })}
      </div>
    </div>
  );
}

/* ─── New vs Returning ────────────────────────── */

const NVR_ICONS: Record<string, typeof UserPlus> = {
  new: UserPlus,
  returning: UserCheck,
};

function NewVsReturningSection({ segments }: { segments: Ga4NewVsReturning[] }) {
  return (
    <div className="space-y-2">
      <h4 className="section-title text-xs flex items-center gap-1.5">
        <Users size={12} />
        New vs Returning
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {segments.map((s) => {
          const Icon = NVR_ICONS[s.segment.toLowerCase()] || Users;
          return (
            <StatCard
              key={s.segment}
              label={s.segment.charAt(0).toUpperCase() + s.segment.slice(1)}
              value={s.activeUsers}
              icon={Icon}
              color={s.segment.toLowerCase() === "new" ? "var(--success)" : "var(--primary)"}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ─── Top Countries ───────────────────────────── */

function CountriesSection({ countries }: { countries: Ga4GeoEntry[] }) {
  return (
    <div className="space-y-2">
      <h4 className="section-title text-xs flex items-center gap-1.5">
        <MapPin size={12} />
        Top Countries
      </h4>
      <div className="space-y-1">
        {countries.map((c, i) => (
          <div key={c.country} className="flex items-center gap-2 text-xs">
            <span className="w-4 text-muted-foreground font-mono">{i + 1}</span>
            <span className="flex-1 truncate">{c.country}</span>
            <span className="font-mono text-muted-foreground">{c.activeUsers.toLocaleString()} users</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Website Panel ───────────────────────────── */

function WebsitePanel({ website }: { website: WebsitePayload }) {
  const series = useMemo(() => {
    if (website.provider === "ga4") return Array.isArray(website.series) ? website.series : [];
    if (website.provider === "plausible") return Array.isArray(website.series) ? website.series : [];
    return [];
  }, [website]);
  const ga4Series: Ga4SeriesPoint[] =
    website.provider === "ga4" && Array.isArray(website.series) ? website.series : [];
  const plausibleSeries: PlausibleSeriesPoint[] =
    website.provider === "plausible" && Array.isArray(website.series) ? website.series : [];

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="section-title flex items-center gap-2">
          <Globe size={14} />
          Website
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            {website.provider.toUpperCase()}
          </span>
        </h3>
        <ProviderHealthHint health={website.health} compact />
      </div>

      <div className="panel-body space-y-4">
        {website.provider === "ga4" && website.configured && website.summary ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard
                label="Active users"
                value={website.summary.activeUsers}
                icon={Users}
                sparkline={ga4Series.map((p) => ({ value: p.activeUsers }))}
                color="var(--primary)"
              />
              <StatCard
                label="Pageviews"
                value={website.summary.pageviews}
                icon={Activity}
                sparkline={ga4Series.map((p) => ({ value: p.pageviews }))}
                color="var(--info)"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="card p-4">
                <div className="text-xs text-muted-foreground">Sessions</div>
                <div className="text-lg font-mono font-semibold mt-1">
                  {website.summary.sessions.toLocaleString()}
                </div>
              </div>
              <div className="card p-4">
                <div className="text-xs text-muted-foreground">Avg session</div>
                <div className="text-lg font-mono font-semibold mt-1">
                  {formatDurationSeconds(website.summary.avgSessionDurationSeconds ?? 0)}
                </div>
              </div>
            </div>

            {typeof website.summary.bounceRatePct === "number" && (
              <div className="card p-4">
                <div className="text-xs text-muted-foreground">Bounce rate</div>
                <div className="text-lg font-mono font-semibold mt-1">
                  {website.summary.bounceRatePct.toFixed(1)}%
                </div>
              </div>
            )}

            {series.length > 1 && (
              <div className="panel bg-transparent border border-border/30">
                <div className="panel-header">
                  <h4 className="section-title">Traffic (daily)</h4>
                </div>
                <div className="panel-body">
                  <TrendChart
                    data={series as unknown as Record<string, unknown>[]}
                    xKey="date"
                    lines={[
                      { key: "activeUsers", color: "var(--primary)", label: "Users" },
                      { key: "pageviews", color: "var(--info)", label: "Pageviews" },
                      { key: "sessions", color: "var(--success)", label: "Sessions" },
                    ]}
                  />
                </div>
              </div>
            )}

            {/* ── Enhanced GA4 Breakdowns ── */}

            {website.trafficSources && website.trafficSources.length > 0 && (
              <TrafficSourcesSection sources={website.trafficSources} />
            )}

            {website.topPages && website.topPages.length > 0 && (
              <TopPagesSection pages={website.topPages} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {website.deviceSplit && website.deviceSplit.length > 0 && (
                <DeviceSplitSection devices={website.deviceSplit} />
              )}
              {website.newVsReturning && website.newVsReturning.length > 0 && (
                <NewVsReturningSection segments={website.newVsReturning} />
              )}
            </div>

            {website.countries && website.countries.length > 0 && (
              <CountriesSection countries={website.countries} />
            )}

            {"iframeUrl" in website && website.iframeUrl && (
              <AnalyticsEmbed title="Website analytics embed" src={website.iframeUrl} />
            )}
          </>
        ) : website.provider === "plausible" && website.configured && website.summary ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard
                label="Visitors"
                value={website.summary.visitors}
                icon={Users}
                sparkline={plausibleSeries.map((p) => ({ value: p.visitors }))}
                color="var(--primary)"
              />
              <StatCard
                label="Pageviews"
                value={website.summary.pageviews}
                icon={Activity}
                sparkline={plausibleSeries.map((p) => ({ value: p.pageviews }))}
                color="var(--info)"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="card p-4">
                <div className="text-xs text-muted-foreground">Bounce rate</div>
                <div className="text-lg font-mono font-semibold mt-1">
                  {(website.summary.bounceRatePct ?? 0).toFixed(1)}%
                </div>
              </div>
              <div className="card p-4">
                <div className="text-xs text-muted-foreground">Visit duration</div>
                <div className="text-lg font-mono font-semibold mt-1">
                  {formatDurationSeconds(website.summary.visitDurationSeconds ?? 0)}
                </div>
              </div>
            </div>

            {series.length > 1 && (
              <div className="panel bg-transparent border border-border/30">
                <div className="panel-header">
                  <h4 className="section-title">Traffic (daily)</h4>
                </div>
                <div className="panel-body">
                  <TrendChart
                    data={series as unknown as Record<string, unknown>[]}
                    xKey="date"
                    lines={[
                      { key: "visitors", color: "var(--primary)", label: "Visitors" },
                      { key: "pageviews", color: "var(--info)", label: "Pageviews" },
                    ]}
                  />
                </div>
              </div>
            )}

            {"iframeUrl" in website && website.iframeUrl && (
              <AnalyticsEmbed title="Website analytics embed" src={website.iframeUrl} />
            )}
          </>
        ) : website.provider === "iframe" ? (
          <AnalyticsEmbed title="Website analytics embed" src={website.iframeUrl} />
        ) : (
          <ProviderConfigCard
            providerName="Google Analytics / Plausible"
            title="Website analytics isn't connected"
            description="Connect Google Analytics (GA4) or Plausible to monitor visitors, traffic sources, and web page performance."
            configureHref="/integrations"
            configureLabel="Configure Integrations"
            error={"error" in website ? website.error : undefined}
            icon={Globe}
          />
        )}
      </div>
    </div>
  );
}

function XPanel({ x, days }: { x: AnalyticsPayload["x"]; days: number }) {
  const series = Array.isArray(x.series) ? x.series : [];
  const spark = series.map((p) => ({ value: p.likes + p.replies + p.reposts + p.quotes }));

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="section-title flex items-center gap-2">
          <X size={14} />
          X
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            {x.configured ? `${days}d` : "OFF"}
          </span>
        </h3>
        <ProviderHealthHint health={x.health} compact />
      </div>
      <div className="panel-body space-y-4">
        {x.configured && x.summary ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard label="Followers" value={x.summary.followers} icon={Users} color="var(--primary)" />
              <StatCard
                label="Engagement"
                value={x.summary.likes + x.summary.replies + x.summary.reposts + x.summary.quotes}
                icon={MousePointerClick}
                sparkline={spark}
                color="var(--success)"
              />
            </div>
            <div className="card p-4">
              <div className="text-xs text-muted-foreground">@{x.summary.username}</div>
              <div className="text-[11px] text-muted-foreground mt-2">
                Posts <span className="font-mono text-foreground">{x.summary.postsInRange}</span>, likes{" "}
                <span className="font-mono text-foreground">{x.summary.likes}</span>, replies{" "}
                <span className="font-mono text-foreground">{x.summary.replies}</span>, reposts{" "}
                <span className="font-mono text-foreground">{x.summary.reposts}</span>, quotes{" "}
                <span className="font-mono text-foreground">{x.summary.quotes}</span>.
              </div>
            </div>
            {series.length > 1 && (
              <div className="panel bg-transparent border border-border/30">
                <div className="panel-header">
                  <h4 className="section-title">Engagement (daily)</h4>
                </div>
                <div className="panel-body">
                  <TrendChart
                    data={series as unknown as Record<string, unknown>[]}
                    xKey="date"
                    lines={[
                      { key: "likes", color: "var(--success)", label: "Likes" },
                      { key: "replies", color: "var(--info)", label: "Replies" },
                      { key: "reposts", color: "var(--warning)", label: "Reposts" },
                      { key: "quotes", color: "var(--primary)", label: "Quotes" },
                    ]}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <ProviderConfigCard
            providerName="X (Twitter)"
            title="X integration isn't connected"
            description="Connect the X API to load live social analytics, follower counts, and post metrics."
            configureHref="/integrations"
            configureLabel="Configure Integration"
            error={x.error}
            icon={X}
          />
        )}
      </div>
    </div>
  );
}

function LinkedInPanel({
  linkedin,
  days,
}: {
  linkedin: AnalyticsPayload["linkedin"];
  days: number;
}) {
  const s = linkedin.summary;
  const series = Array.isArray(linkedin.series) ? linkedin.series : [];

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="section-title flex items-center gap-2">
          <Linkedin size={14} />
          LinkedIn
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            {linkedin.configured ? `${days}d` : "OFF"}
          </span>
        </h3>
        <ProviderHealthHint health={linkedin.health} compact />
      </div>
      <div className="panel-body space-y-4">
        {linkedin.configured && s ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard label="Followers" value={s.followers ?? 0} icon={Users} color="var(--primary)" />
              <StatCard
                label="Impressions"
                value={s.impressions ?? 0}
                icon={Activity}
                color="var(--info)"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard label="Clicks" value={s.clicks ?? 0} icon={MousePointerClick} color="var(--success)" />
              <div className="card p-4">
                <div className="text-xs text-muted-foreground">Engagement rate</div>
                <div className="text-lg font-mono font-semibold mt-1">
                  {(s.engagementRatePct ?? 0).toFixed(2)}%
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  Likes <span className="font-mono text-foreground">{s.likes ?? 0}</span>, comments{" "}
                  <span className="font-mono text-foreground">{s.comments ?? 0}</span>, shares{" "}
                  <span className="font-mono text-foreground">{s.shares ?? 0}</span>.
                </div>
              </div>
            </div>

            {series.length > 1 && (
              <div className="panel bg-transparent border border-border/30">
                <div className="panel-header">
                  <h4 className="section-title">Impressions & Clicks (daily)</h4>
                </div>
                <div className="panel-body">
                  <TrendChart
                    data={series as unknown as Record<string, unknown>[]}
                    xKey="date"
                    lines={[
                      { key: "impressions", color: "var(--info)", label: "Impressions" },
                      { key: "clicks", color: "var(--success)", label: "Clicks" },
                    ]}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <ProviderConfigCard
            providerName="LinkedIn"
            title="LinkedIn integration isn't connected"
            description="Connect LinkedIn API credentials to track page impressions, follower counts, and post engagement."
            configureHref="/integrations"
            configureLabel="Configure Integration"
            error={linkedin.error}
            icon={Linkedin}
          />
        )}
      </div>
    </div>
  );
}

function SocialPanel({
  social,
  series,
}: {
  social: AnalyticsPayload["social"];
  series: SocialAnalyticsPoint[];
}) {
  const sparkImpressions = series.map((p) => ({ value: p.impressions }));
  const sparkEngagement = series.map((p) => ({ value: p.engagement }));
  const sparkLeads = series.map((p) => ({ value: p.leads }));
  const sparkSends = series.map((p) => ({ value: p.emailsSent }));

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="section-title flex items-center gap-2">
          <MousePointerClick size={14} />
          Social (Internal Rollups)
        </h3>
      </div>

      <div className="panel-body space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Impressions"
            value={social.summary.impressions}
            icon={Activity}
            sparkline={sparkImpressions}
            color="var(--primary)"
          />
          <StatCard
            label="Engagement"
            value={social.summary.engagement}
            icon={MousePointerClick}
            sparkline={sparkEngagement}
            color="var(--success)"
          />
          <StatCard
            label="Leads"
            value={social.summary.leads}
            icon={Users}
            sparkline={sparkLeads}
            color="var(--info)"
          />
          <StatCard
            label="Emails Sent"
            value={social.summary.emailsSent}
            icon={Send}
            sparkline={sparkSends}
            color="var(--warning)"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="text-xs text-muted-foreground">Engagement rate</div>
            <div className="text-lg font-mono font-semibold mt-1">
              {social.summary.engagementRatePct.toFixed(2)}%
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              X posts <span className="font-mono text-foreground">{social.summary.xPosts}</span>, replies{" "}
              <span className="font-mono text-foreground">{social.summary.xReplies}</span>, quotes{" "}
              <span className="font-mono text-foreground">{social.summary.xQuoteTweets}</span>, follows{" "}
              <span className="font-mono text-foreground">{social.summary.xFollows}</span>.
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted-foreground">LinkedIn</div>
            <div className="text-[11px] text-muted-foreground mt-2">
              Comments{" "}
              <span className="font-mono text-foreground">{social.summary.linkedinComments}</span>.
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              (Internal rollups come from Hermes activity, not platform analytics APIs.)
            </div>
          </div>
        </div>

        {series.length > 1 && (
          <div className="panel bg-transparent border border-border/30">
            <div className="panel-header">
              <h4 className="section-title">Impressions & Engagement (daily)</h4>
            </div>
            <div className="panel-body">
              <TrendChart
                data={series as unknown as Record<string, unknown>[]}
                xKey="date"
                lines={[
                  { key: "impressions", color: "var(--primary)", label: "Impressions" },
                  { key: "engagement", color: "var(--success)", label: "Engagement" },
                ]}
              />
            </div>
          </div>
        )}

        {social.iframeUrl && (
          <AnalyticsEmbed title="Social analytics embed" src={social.iframeUrl} />
        )}
      </div>
    </div>
  );
}

function AnalyticsEmbed({ title, src }: { title: string; src: string }) {
  return (
    <div className="card p-0 overflow-hidden border border-border/40">
      <div className="px-4 py-2 border-b border-border/30 text-xs text-muted-foreground">
        {title}
      </div>
      <div className="w-full aspect-[16/10] bg-muted">
        <iframe
          title={title}
          src={src}
          className="w-full h-full"
          referrerPolicy="no-referrer"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
