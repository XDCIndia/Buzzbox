import type Database from 'better-sqlite3';
import { DEFAULT_BRAND_ID } from '../src/lib/brand-constants';

/* Safety guards for scripts/seed.ts (#102). Kept in a side-effect-free module
 * so unit tests can import it without opening a database or seeding anything.
 *
 * The seed script wipes 16 tables. These helpers make that survivable:
 *  - parseSeedArgs: --force bypasses every guard; --yes/-y skips only the
 *    interactive prompt (production + non-seed refusals still apply).
 *  - findNonSeedRows: rows whose id is absent from seed_registry are operator
 *    data. A missing registry (pre-guard databases) means every row counts.
 */

export interface SeedOptions {
  /** Bypass production, non-seed-data, and interactive guards. */
  force: boolean;
  /** Skip the interactive confirmation prompt only. */
  yes: boolean;
}

export function parseSeedArgs(argv: string[]): SeedOptions {
  const force = argv.includes('--force');
  const yes = force || argv.includes('--yes') || argv.includes('-y');
  return { force, yes };
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Tables the seed script wipes, with the column that identifies a row for
 * seed_registry tracking (all values are stored there as TEXT). */
export const SEED_TRACKED_TABLES: { table: string; idColumn: string }[] = [
  { table: 'content_posts', idColumn: 'id' },
  { table: 'leads', idColumn: 'id' },
  { table: 'sequences', idColumn: 'id' },
  { table: 'suppression', idColumn: 'email' },
  { table: 'engagements', idColumn: 'id' },
  { table: 'signals', idColumn: 'id' },
  { table: 'experiments', idColumn: 'id' },
  { table: 'learnings', idColumn: 'id' },
  { table: 'daily_metrics', idColumn: 'date' },
  { table: 'activity_log', idColumn: 'id' },
  { table: 'brands', idColumn: 'id' },
  { table: 'brand_mentions', idColumn: 'id' },
  { table: 'brand_competitors', idColumn: 'id' },
  { table: 'brand_campaigns', idColumn: 'id' },
  { table: 'brand_alerts', idColumn: 'id' },
  { table: 'brand_digests', idColumn: 'id' },
];

export interface NonSeedTable {
  table: string;
  count: number;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return !!row;
}

/** Rows in seed-wiped tables that seed_registry does not account for.
 * Returns one entry per affected table; empty means only seeded rows exist
 * (or the tables are empty).
 *
 * The migrate() data-guarantee row (DEFAULT_BRAND_ID under a placeholder
 * name) is placeholder, not operator data -- it is excluded with the same
 * condition as the v3 backfill in db.ts. A renamed (adopted) brand row is
 * still reported. */
export function findNonSeedRows(db: Database.Database): NonSeedTable[] {
  const hasRegistry = tableExists(db, 'seed_registry');
  const out: NonSeedTable[] = [];
  for (const { table, idColumn } of SEED_TRACKED_TABLES) {
    if (!tableExists(db, table)) continue;
    // Placeholder exclusion applies to the brands table only.
    const placeholderClause =
      table === 'brands'
        ? ` AND NOT ("id" = '${DEFAULT_BRAND_ID}' AND "name" IN ('Hermes', 'My Brand'))`
        : '';
    const count = (
      hasRegistry
        ? db
            .prepare(
              `SELECT COUNT(*) AS c FROM "${table}" WHERE CAST("${idColumn}" AS TEXT) NOT IN (SELECT record_id FROM seed_registry WHERE table_name = ?)${placeholderClause}`,
            )
            .get(table)
        : db.prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE 1=1${placeholderClause}`).get()
    ) as { c: number };
    if (count.c > 0) out.push({ table, count: count.c });
  }
  return out;
}

export function formatNonSeedReport(rows: NonSeedTable[]): string {
  return rows.map(r => `  ${r.table}: ${r.count} non-seed row(s)`).join('\n');
}
