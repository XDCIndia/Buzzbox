import { getDb } from './db';

/* Crisis/high-impact mention alerting.
 *
 * Mention syncs already classify sentiment and reach; this module turns the
 * dangerous combination into an actionable in-app notification instead of a
 * number someone has to notice on a dashboard. Crisis detection is
 * deliberately simple and explainable: a LARGE account saying something
 * NEGATIVE about the brand. Reach thresholds:
 *   - crisis:      >= 50k reach AND negative sentiment
 *   - high-impact: >= 100k reach (any sentiment)
 * A high-impact positive mention is news worth knowing; a high-impact
 * negative mention is a crisis, not both. */

export const CRISIS_REACH_THRESHOLD = 50_000;
export const HIGH_IMPACT_REACH_THRESHOLD = 100_000;

export interface MentionAlertInput {
  author_reach: number | null;
  sentiment: string | null;
  is_crisis?: boolean;
  is_high_impact?: boolean;
}

export type MentionAlertKind = 'crisis' | 'high-impact';

export function evaluateMentionCrisis(m: MentionAlertInput): MentionAlertKind | null {
  const reach = m.author_reach || 0;
  if (reach >= CRISIS_REACH_THRESHOLD && m.sentiment === 'negative') return 'crisis';
  if (reach >= HIGH_IMPACT_REACH_THRESHOLD) return 'high-impact';
  return null;
}

export interface MentionAlertContext {
  brandName: string;
  platform: string;
  author_name: string | null;
  author_handle: string | null;
  text: string;
  url: string | null;
  mentionId: string;
}

export function insertMentionAlert(kind: MentionAlertKind, ctx: MentionAlertContext): void {
  const who = ctx.author_handle
    ? `@${ctx.author_handle}`
    : ctx.author_name || 'Unknown author';
  const preview = ctx.text.length > 140 ? `${ctx.text.slice(0, 140)}…` : ctx.text;
  const type = kind === 'crisis' ? 'mention_crisis' : 'mention_high_impact';
  const severity = kind === 'crisis' ? 'critical' : 'warning';
  const title =
    kind === 'crisis'
      ? `Crisis mention from ${who} (${ctx.platform})`
      : `High-impact mention from ${who} (${ctx.platform})`;
  const message =
    kind === 'crisis'
      ? `Negative post from a large account (${who}) on ${ctx.platform}: "${preview}"`
      : `${who} posted about ${ctx.brandName} on ${ctx.platform}: "${preview}"`;

  getDb()
    .prepare(
      `INSERT INTO notifications (type, severity, title, message, data, read)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(
      type,
      severity,
      title,
      message,
      JSON.stringify({ mention_id: ctx.mentionId, url: ctx.url, platform: ctx.platform }),
    );
}
