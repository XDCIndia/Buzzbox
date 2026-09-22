import { NextRequest, NextResponse } from "next/server";
import { getDailyMetrics } from "@/lib/queries";
import { requireApiUser } from "@/lib/api-auth";
import { clampDays, computeSocialAnalytics, isSafeExternalUrl } from "@/lib/analytics";
import { fetchPlausibleWebsiteAnalytics } from "@/lib/plausible";
import { fetchGa4WebsiteAnalytics } from "@/lib/ga4";
import { fetchXAccountAnalytics } from "@/lib/x-api";
import { fetchLinkedInOrgAnalytics } from "@/lib/linkedin";

type ProviderState = {
  provider: string;
  configured: boolean;
  error?: string;
  health?: {
    latency_ms?: number;
    attempts?: number;
    retry_count?: number;
    last_success_at?: string;
    last_error_at?: string;
    stale_after_seconds?: number;
    next_retry_after_seconds?: number;
  };
  [key: string]: unknown;
};

type ProviderRunResult<T> =
  | {
      ok: true;
      data: T;
      latencyMs: number;
      attempts: number;
      retryCount: number;
      lastSuccessAt: string;
    }
  | {
      ok: false;
      error: string;
      latencyMs: number;
      attempts: number;
      retryCount: number;
      lastErrorAt: string;
    };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProviderWithRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; retryDelayMs?: number } = {},
): Promise<ProviderRunResult<T>> {
  const maxAttempts = Math.max(1, opts.attempts ?? 2);
  const retryDelayMs = Math.max(0, opts.retryDelayMs ?? 250);
  const startedAt = Date.now();

  let attempts = 0;
  let lastError = 'Unknown provider error';

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const data = await fn();
      return {
        ok: true,
        data,
        latencyMs: Date.now() - startedAt,
        attempts,
        retryCount: Math.max(0, attempts - 1),
        lastSuccessAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempts < maxAttempts) {
        await delay(retryDelayMs * attempts);
      }
    }
  }

  return {
    ok: false,
    error: lastError,
    latencyMs: Date.now() - startedAt,
    attempts,
    retryCount: Math.max(0, attempts - 1),
    lastErrorAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;

  const { searchParams } = req.nextUrl;
  const days = clampDays(searchParams.get("days"), 30);
  const real = searchParams.get("real") === "true";

  const rawDaily = getDailyMetrics(days, { excludeSeed: real });
  const dailyAsc = [...rawDaily].reverse();
  const social = computeSocialAnalytics(dailyAsc);

  const websiteIframeUrlRaw = process.env.HERMES_ANALYTICS_WEBSITE_IFRAME_URL;
  const socialIframeUrlRaw = process.env.HERMES_ANALYTICS_SOCIAL_IFRAME_URL;
  const websiteIframeUrl = isSafeExternalUrl(websiteIframeUrlRaw) ? websiteIframeUrlRaw : null;
  const socialIframeUrl = isSafeExternalUrl(socialIframeUrlRaw) ? socialIframeUrlRaw : null;

  // Website analytics preference: GA4 -> Plausible -> embed.
  const ga4PropertyId = process.env.GA4_PROPERTY_ID || process.env.GA4_PROPERTY || null;
  const ga4ServiceAccountJson = process.env.GA4_SERVICE_ACCOUNT_JSON || null;
  const ga4ServiceAccountJsonB64 = process.env.GA4_SERVICE_ACCOUNT_JSON_B64 || null;

  const plausibleSiteId = process.env.PLAUSIBLE_SITE_ID;
  const plausibleApiKey = process.env.PLAUSIBLE_API_KEY;
  const plausibleBaseUrl = process.env.PLAUSIBLE_BASE_URL || "https://plausible.io";

  let website: ProviderState = { provider: "none", configured: false };

  if (ga4PropertyId && (ga4ServiceAccountJson || ga4ServiceAccountJsonB64)) {
    const ga4Run = await runProviderWithRetry(() => fetchGa4WebsiteAnalytics({
        propertyId: ga4PropertyId,
        days,
        serviceAccountJson: ga4ServiceAccountJson,
        serviceAccountJsonB64: ga4ServiceAccountJsonB64,
      }));
    if (ga4Run.ok) {
      const ga4 = ga4Run.data;
      website = {
        provider: "ga4",
        configured: true,
        summary: ga4.summary,
        series: ga4.series,
        topPages: ga4.topPages,
        trafficSources: ga4.trafficSources,
        deviceSplit: ga4.deviceSplit,
        newVsReturning: ga4.newVsReturning,
        countries: ga4.countries,
        health: {
          latency_ms: ga4Run.latencyMs,
          attempts: ga4Run.attempts,
          retry_count: ga4Run.retryCount,
          last_success_at: ga4Run.lastSuccessAt,
          stale_after_seconds: 3_600,
          next_retry_after_seconds: 300,
        },
      };
    } else {
      website = {
        provider: "ga4",
        configured: false,
        error: ga4Run.error,
        health: {
          latency_ms: ga4Run.latencyMs,
          attempts: ga4Run.attempts,
          retry_count: ga4Run.retryCount,
          last_error_at: ga4Run.lastErrorAt,
          stale_after_seconds: 3_600,
          next_retry_after_seconds: 300,
        },
        ...(websiteIframeUrl ? { iframeUrl: websiteIframeUrl } : {}),
      };
    }
  } else if (plausibleSiteId && plausibleApiKey) {
    const plausibleRun = await runProviderWithRetry(() => fetchPlausibleWebsiteAnalytics({
        baseUrl: plausibleBaseUrl,
        siteId: plausibleSiteId,
        apiKey: plausibleApiKey,
        days,
      }));
    if (plausibleRun.ok) {
      const plausible = plausibleRun.data;
      website = {
        provider: "plausible",
        configured: true,
        summary: plausible.summary,
        series: plausible.series,
        health: {
          latency_ms: plausibleRun.latencyMs,
          attempts: plausibleRun.attempts,
          retry_count: plausibleRun.retryCount,
          last_success_at: plausibleRun.lastSuccessAt,
          stale_after_seconds: 3_600,
          next_retry_after_seconds: 300,
        },
      };
    } else {
      website = {
        provider: "plausible",
        configured: false,
        error: plausibleRun.error,
        health: {
          latency_ms: plausibleRun.latencyMs,
          attempts: plausibleRun.attempts,
          retry_count: plausibleRun.retryCount,
          last_error_at: plausibleRun.lastErrorAt,
          stale_after_seconds: 3_600,
          next_retry_after_seconds: 300,
        },
        ...(websiteIframeUrl ? { iframeUrl: websiteIframeUrl } : {}),
      };
    }
  } else if (websiteIframeUrl) {
    website = { provider: "iframe", configured: true, iframeUrl: websiteIframeUrl };
  } else {
    website = {
      provider: "none",
      configured: false,
      error:
        "Not configured. Set GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT_JSON (recommended) or PLAUSIBLE_SITE_ID + PLAUSIBLE_API_KEY, or HERMES_ANALYTICS_WEBSITE_IFRAME_URL.",
    };
  }

  // Social native connectors.
  let x: ProviderState = { provider: "x", configured: false };
  const xBearer = process.env.X_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN || null;
  const xUsername = process.env.X_USERNAME || null;
  if (xBearer && xUsername) {
    // Same user-context credential posting uses (maybePublishToX); when set,
    // the X provider can also read non_public_metrics (impressions).
    const xUserToken = process.env.X_ACCESS_TOKEN || null;
    const xRun = await runProviderWithRetry(() => fetchXAccountAnalytics({ bearerToken: xBearer, username: xUsername, days, userAccessToken: xUserToken }));
    if (xRun.ok) {
      const out = xRun.data;
      x = {
        provider: "x",
        configured: true,
        summary: out.summary,
        series: out.series,
        health: {
          latency_ms: xRun.latencyMs,
          attempts: xRun.attempts,
          retry_count: xRun.retryCount,
          last_success_at: xRun.lastSuccessAt,
          stale_after_seconds: 10_800,
          next_retry_after_seconds: 600,
        },
      };
    } else {
      x = {
        provider: "x",
        configured: false,
        error: xRun.error,
        health: {
          latency_ms: xRun.latencyMs,
          attempts: xRun.attempts,
          retry_count: xRun.retryCount,
          last_error_at: xRun.lastErrorAt,
          stale_after_seconds: 10_800,
          next_retry_after_seconds: 600,
        },
      };
    }
  }

  let linkedin: ProviderState = { provider: "linkedin", configured: false };
  const liToken = process.env.LINKEDIN_ACCESS_TOKEN || null;
  const liOrgUrn = process.env.LINKEDIN_ORGANIZATION_URN || null;
  const liVersion = process.env.LINKEDIN_VERSION || null;
  if (liToken && liOrgUrn) {
    const liRun = await runProviderWithRetry(() => fetchLinkedInOrgAnalytics({
        accessToken: liToken,
        organizationUrn: liOrgUrn,
        version: liVersion || undefined,
      }));
    if (liRun.ok) {
      const out = liRun.data;
      linkedin = {
        provider: "linkedin",
        configured: true,
        summary: out.summary,
        series: out.series,
        health: {
          latency_ms: liRun.latencyMs,
          attempts: liRun.attempts,
          retry_count: liRun.retryCount,
          last_success_at: liRun.lastSuccessAt,
          stale_after_seconds: 10_800,
          next_retry_after_seconds: 600,
        },
      };
    } else {
      linkedin = {
        provider: "linkedin",
        configured: false,
        error: liRun.error,
        health: {
          latency_ms: liRun.latencyMs,
          attempts: liRun.attempts,
          retry_count: liRun.retryCount,
          last_error_at: liRun.lastErrorAt,
          stale_after_seconds: 10_800,
          next_retry_after_seconds: 600,
        },
      };
    }
  }

  return NextResponse.json({
    days,
    website,
    x,
    linkedin,
    social: {
      provider: "internal",
      configured: true,
      summary: social.summary,
      series: social.series,
      iframeUrl: socialIframeUrl,
    },
  });
}
