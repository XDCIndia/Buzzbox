import { fetchWithTimeout } from './fetch-with-timeout';
import { GoogleAuth, type JWTInput } from "google-auth-library";

export interface Ga4Summary {
  activeUsers: number;
  sessions: number;
  pageviews: number;
  bounceRatePct?: number;
  avgSessionDurationSeconds?: number;
}

export interface Ga4SeriesPoint {
  date: string; // YYYY-MM-DD
  activeUsers: number;
  sessions: number;
  pageviews: number;
}

export interface Ga4TopPage {
  pagePath: string;
  pageTitle: string;
  pageviews: number;
  activeUsers: number;
}

export interface Ga4TrafficSource {
  channel: string;
  sessions: number;
  activeUsers: number;
}

export interface Ga4DeviceSplit {
  device: string; // desktop | mobile | tablet
  activeUsers: number;
}

export interface Ga4NewVsReturning {
  segment: string; // new | returning
  activeUsers: number;
}

export interface Ga4GeoEntry {
  country: string;
  activeUsers: number;
  sessions: number;
}

export interface Ga4AnalyticsResult {
  summary: Ga4Summary;
  series: Ga4SeriesPoint[];
  topPages?: Ga4TopPage[];
  trafficSources?: Ga4TrafficSource[];
  deviceSplit?: Ga4DeviceSplit[];
  newVsReturning?: Ga4NewVsReturning[];
  countries?: Ga4GeoEntry[];
}

const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

interface Ga4MetricValue {
  value?: string | number;
}

interface Ga4DimensionValue {
  value?: string;
}

interface Ga4Row {
  dimensionValues?: Ga4DimensionValue[];
  metricValues?: Ga4MetricValue[];
}

interface Ga4ReportResponse {
  rows?: Ga4Row[];
}

function isGa4SeriesPoint(value: Ga4SeriesPoint | null): value is Ga4SeriesPoint {
  return value !== null;
}

function toIsoDateFromGa4Compact(compact: string): string {
  if (!/^\d{8}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function metricNumber(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? n : 0;
}

function parseServiceAccountJson(env: {
  serviceAccountJson?: string | null;
  serviceAccountJsonB64?: string | null;
}): JWTInput | null {
  const raw = (env.serviceAccountJson || "").trim();
  if (raw) {
    try {
      return JSON.parse(raw) as JWTInput;
    } catch {
      // fall through
    }
  }
  const b64 = (env.serviceAccountJsonB64 || "").trim();
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      return JSON.parse(decoded) as JWTInput;
    } catch {
      return null;
    }
  }
  return null;
}

async function ga4Fetch<T>(accessToken: string, url: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 Data API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function fetchGa4WebsiteAnalytics(opts: {
  propertyId: string;
  days: number;
  serviceAccountJson?: string | null;
  serviceAccountJsonB64?: string | null;
}): Promise<Ga4AnalyticsResult> {
  const creds = parseServiceAccountJson({
    serviceAccountJson: opts.serviceAccountJson,
    serviceAccountJsonB64: opts.serviceAccountJsonB64,
  });
  if (!creds) {
    throw new Error("GA4 service account JSON is not configured or invalid");
  }

  const auth = new GoogleAuth({
    credentials: creds,
    scopes: [GA4_SCOPE],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === "string" ? token : token?.token;
  if (!accessToken) throw new Error("Failed to obtain Google access token");

  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
    opts.propertyId
  )}:runReport`;

  const dateRanges = [{ startDate: `${opts.days}daysAgo`, endDate: "today" }];

  // 1) Aggregate summary
  let summary: Ga4Summary;
  try {
    const aggregate = await ga4Fetch<Ga4ReportResponse>(accessToken, base, {
      dateRanges,
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
    });

    const values = aggregate.rows?.[0]?.metricValues?.map((m) => m?.value) ?? [];
    summary = {
      activeUsers: metricNumber(values[0]),
      sessions: metricNumber(values[1]),
      pageviews: metricNumber(values[2]),
      bounceRatePct: metricNumber(values[3]) * 100,
      avgSessionDurationSeconds: metricNumber(values[4]),
    };
  } catch {
    const aggregate = await ga4Fetch<Ga4ReportResponse>(accessToken, base, {
      dateRanges,
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
    });
    const values = aggregate.rows?.[0]?.metricValues?.map((m) => m?.value) ?? [];
    summary = {
      activeUsers: metricNumber(values[0]),
      sessions: metricNumber(values[1]),
      pageviews: metricNumber(values[2]),
    };
  }

  // 2) Daily timeseries
  const report = await ga4Fetch<Ga4ReportResponse>(accessToken, base, {
    dateRanges,
    dimensions: [{ name: "date" }],
    metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });

  const series: Ga4SeriesPoint[] = Array.isArray(report.rows)
    ? report.rows
        .map((r) => {
          const dateCompact = r?.dimensionValues?.[0]?.value;
          if (typeof dateCompact !== "string" || !dateCompact) return null;
          const mv = r?.metricValues?.map((m) => m?.value) ?? [];
          return {
            date: toIsoDateFromGa4Compact(dateCompact),
            activeUsers: metricNumber(mv[0]),
            sessions: metricNumber(mv[1]),
            pageviews: metricNumber(mv[2]),
          };
        })
        .filter(isGa4SeriesPoint)
    : [];

  // 3) Dimension breakdowns — parallel, non-blocking
  const [topPagesResult, trafficSourcesResult, deviceResult, newRetResult, countriesResult] =
    await Promise.allSettled([
      // Top pages
      ga4Fetch<Ga4ReportResponse>(accessToken, base, {
        dateRanges,
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
      // Traffic sources
      ga4Fetch<Ga4ReportResponse>(accessToken, base, {
        dateRanges,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      // Device split
      ga4Fetch<Ga4ReportResponse>(accessToken, base, {
        dateRanges,
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      }),
      // New vs returning
      ga4Fetch<Ga4ReportResponse>(accessToken, base, {
        dateRanges,
        dimensions: [{ name: "newVsReturning" }],
        metrics: [{ name: "activeUsers" }],
      }),
      // Countries
      ga4Fetch<Ga4ReportResponse>(accessToken, base, {
        dateRanges,
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 5,
      }),
    ]);

  const topPages: Ga4TopPage[] | undefined =
    topPagesResult.status === "fulfilled" && Array.isArray(topPagesResult.value?.rows)
      ? topPagesResult.value.rows.map((r) => ({
          pagePath: r?.dimensionValues?.[0]?.value ?? "",
          pageTitle: r?.dimensionValues?.[1]?.value ?? "(not set)",
          pageviews: metricNumber(r?.metricValues?.[0]?.value),
          activeUsers: metricNumber(r?.metricValues?.[1]?.value),
        }))
      : undefined;

  const trafficSources: Ga4TrafficSource[] | undefined =
    trafficSourcesResult.status === "fulfilled" && Array.isArray(trafficSourcesResult.value?.rows)
      ? trafficSourcesResult.value.rows.map((r) => ({
          channel: r?.dimensionValues?.[0]?.value ?? "(not set)",
          sessions: metricNumber(r?.metricValues?.[0]?.value),
          activeUsers: metricNumber(r?.metricValues?.[1]?.value),
        }))
      : undefined;

  const deviceSplit: Ga4DeviceSplit[] | undefined =
    deviceResult.status === "fulfilled" && Array.isArray(deviceResult.value?.rows)
      ? deviceResult.value.rows.map((r) => ({
          device: r?.dimensionValues?.[0]?.value ?? "unknown",
          activeUsers: metricNumber(r?.metricValues?.[0]?.value),
        }))
      : undefined;

  const newVsReturning: Ga4NewVsReturning[] | undefined =
    newRetResult.status === "fulfilled" && Array.isArray(newRetResult.value?.rows)
      ? newRetResult.value.rows.map((r) => ({
          segment: r?.dimensionValues?.[0]?.value ?? "unknown",
          activeUsers: metricNumber(r?.metricValues?.[0]?.value),
        }))
      : undefined;

  const countries: Ga4GeoEntry[] | undefined =
    countriesResult.status === "fulfilled" && Array.isArray(countriesResult.value?.rows)
      ? countriesResult.value.rows.map((r) => ({
          country: r?.dimensionValues?.[0]?.value ?? "(not set)",
          activeUsers: metricNumber(r?.metricValues?.[0]?.value),
          sessions: metricNumber(r?.metricValues?.[1]?.value),
        }))
      : undefined;

  return { summary, series, topPages, trafficSources, deviceSplit, newVsReturning, countries };
}
