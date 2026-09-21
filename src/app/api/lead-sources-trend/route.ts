import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getHermesStateDir } from '@/lib/hermes-state';
import { requireApiUser } from '@/lib/api-auth';

const STATE_DIR = getHermesStateDir();
const LEADS_PATH = path.join(STATE_DIR, 'leads.json');

type LeadStateRow = {
  created_at?: unknown;
  source?: unknown;
  sources?: unknown;
};

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const leads = readJson<LeadStateRow[]>(LEADS_PATH, []);
    const now = new Date();
    const days = 30;
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));

    const counts: Record<string, number> = {};
    const rows: { date: string; sources: string[] }[] = [];

    for (const lead of leads) {
      const createdAt =
        typeof lead.created_at === 'string' ? new Date(lead.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
      if (createdAt < start) continue;
      const date = dateKey(createdAt);
      const sources: string[] = [];
      if (typeof lead.source === 'string' && lead.source.trim()) sources.push(lead.source);
      if (Array.isArray(lead.sources)) {
        for (const s of lead.sources) {
          if (typeof s === 'string' && s.trim()) sources.push(s);
        }
      }
      if (sources.length === 0) continue;
      rows.push({ date, sources });
      for (const s of sources) counts[s] = (counts[s] || 0) + 1;
    }

    const topSources = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s]) => s);

    const dates: string[] = [];
    const series: Record<string, number[]> = {};
    for (const s of topSources) series[s] = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dateKey(d);
      dates.push(key);
      for (const s of topSources) series[s].push(0);

      for (const r of rows) {
        if (r.date !== key) continue;
        for (const s of r.sources) {
          const idx = topSources.indexOf(s);
          if (idx >= 0) series[s][dates.length - 1] += 1;
        }
      }
    }

    return NextResponse.json({ dates, sources: topSources, series });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
