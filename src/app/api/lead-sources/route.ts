import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getHermesStateDir } from '@/lib/hermes-state';
import { requireApiUser } from '@/lib/api-auth';

const STATE_DIR = getHermesStateDir();
const LEADS_PATH = path.join(STATE_DIR, 'leads.json');

type LeadStateRow = {
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

export async function GET(request: Request) {
  const auth = requireApiUser(request);
  if (auth) return auth;
  try {
    const leads = readJson<LeadStateRow[]>(LEADS_PATH, []);
    const counts: Record<string, number> = {};

    for (const lead of leads) {
      const source = lead.source;
      if (typeof source === 'string' && source.trim()) {
        counts[source] = (counts[source] || 0) + 1;
      }
      const sources = Array.isArray(lead.sources) ? lead.sources : [];
      for (const s of sources) {
        if (typeof s === 'string' && s.trim()) {
          counts[s] = (counts[s] || 0) + 1;
        }
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const sources = Object.entries(counts)
      .map(([source, count]) => ({
        source,
        count,
        share: total > 0 ? count / total : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ total, sources });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
