# Runbook: mention crisis alerts

Buzzbox watches brand mentions during every sync and raises in-app
notifications when a mention looks dangerous. Operators should know what
triggers an alert, where to see it, and how to tune it.

## What fires an alert

A mention must be **freshly inserted** by a mention sync (re-syncing the same
post never re-alerts). Then, based on the author's reach and the mention's
classified sentiment:

| Condition | Alert |
|---|---|
| reach ≥ 50k **and** negative sentiment | `mention_crisis` (severity `critical`) |
| reach ≥ 100k, any sentiment | `mention_high_impact` (severity `warning`) |

A large account saying something negative is a **crisis**, not also a
high-impact alert — crisis takes precedence. Sentiment is classified by
`src/lib/mention-classify.ts` (keyword-based); reach is the author's
follower count reported by the platform API.

## Where alerts surface

- `GET /api/notifications?unread=true` (the header bell) — same pipeline as
  every other in-app notification, so mark-read works as usual.
- Each notification's `data` JSON carries `mention_id`, `url`, and
  `platform` for one-click jump-to-post.

## Tuning

Thresholds live in `src/lib/mention-alerts.ts`:

```ts
export const CRISIS_REACH_THRESHOLD = 50_000;
export const HIGH_IMPACT_REACH_THRESHOLD = 100_000;
```

Raising them reduces noise for large-audience brands; lowering them suits
smaller brands where a 10k-follower complaint matters. Changing the values
takes effect on the next sync — no migration involved.

## False positives / false negatives

- **Sarcasm, profanity-free complaints:** the keyword classifier may score a
  genuinely negative post as `neutral` → no crisis alert (it can still fire
  as high-impact at ≥100k reach).
- **Quoted/retweeted negativity:** X search excludes retweets
  (`-is:retweet`), but quote-tweets with neutral framing may classify neutral.

## Future

Optional Telegram push: the receive-side webhook exists
(`/api/webhook/telegram`); a `sendMessage` helper reading the same
`notifications` table is the planned follow-up once a bot token is
configured.
