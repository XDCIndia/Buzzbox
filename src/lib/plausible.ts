import { fetchWithTimeout } from './fetch-with-timeout';

export interface PlausibleWebsiteSummary {
  visitors: number;
  pageviews: number;
  bounceRatePct: number;
  visitDurationSeconds: number;
}

export interface PlausibleSeriesPoint {
  date: string;
  visitors: number;
  pageviews: number;
}

function metricValue(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "value" in v) {
    const value = (v as { value?: unknown }).value;
    if (typeof value === "number") return value;
  }
  return 0;
}

export async function fetchPlausibleWebsiteAnalytics(opts: {
  baseUrl: string;
  siteId: string;
  apiKey: string;
  days: number;
}): Promise<{ summary: PlausibleWebsiteSummary; series: PlausibleSeriesPoint[] }> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const period = `${opts.days}d`;

  const commonParams = new URLSearchParams({
    site_id: opts.siteId,
    period,
  });

  const aggregateParams = new URLSearchParams(commonParams);
  aggregateParams.set("metrics", "visitors,pageviews,bounce_rate,visit_duration");

  const aggregateRes = await fetchWithTimeout(
    `${baseUrl}/api/v1/stats/aggregate?${aggregateParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      cache: "no-store",
    }
  );

  if (!aggregateRes.ok) {
    throw new Error(`Plausible aggregate failed (${aggregateRes.status})`);
  }

  const aggregateJson = (await aggregateRes.json()) as unknown;
  const aggregateResults =
    (aggregateJson as { results?: Record<string, unknown> })?.results ??
    (aggregateJson as Record<string, unknown>);

  const summary: PlausibleWebsiteSummary = {
    visitors: metricValue(aggregateResults?.visitors),
    pageviews: metricValue(aggregateResults?.pageviews),
    bounceRatePct: metricValue(aggregateResults?.bounce_rate),
    visitDurationSeconds: metricValue(aggregateResults?.visit_duration),
  };

  const timeseriesParams = new URLSearchParams(commonParams);
  timeseriesParams.set("metrics", "visitors,pageviews");

  const seriesRes = await fetchWithTimeout(
    `${baseUrl}/api/v1/stats/timeseries?${timeseriesParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      cache: "no-store",
    }
  );

  if (!seriesRes.ok) {
    throw new Error(`Plausible timeseries failed (${seriesRes.status})`);
  }

  const seriesJson = (await seriesRes.json()) as unknown;
  const seriesResults = (seriesJson as { results?: unknown[] })?.results;

  const series: PlausibleSeriesPoint[] = Array.isArray(seriesResults)
    ? seriesResults
        .map((r) => {
          const row = r as Record<string, unknown>;
          const date = typeof row.date === "string" ? row.date : "";
          if (!date) return null;
          return {
            date,
            visitors: typeof row.visitors === "number" ? row.visitors : 0,
            pageviews: typeof row.pageviews === "number" ? row.pageviews : 0,
          };
        })
        .filter((x): x is PlausibleSeriesPoint => Boolean(x))
    : [];

  return { summary, series };
}

