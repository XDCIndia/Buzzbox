# Brand Monitoring Roadmap (Revision 2 — execution plan)

**From mention tracker to listening platform**

A sequenced, single-track execution plan for closing the gap between the current Brand Mentions build and a fuller SocialSonar-style product — now broken into work items small enough to ship, verify, and commit one at a time.

*marketing-dashboard · revised 2026-08-13 · linear build order, no assumed parallelism*

## Today → Target

| Today | Target |
|---|---|
| One route, seven tabs, one hardcoded brand | Thirteen routed pages across five sidebar groups |
| Filters and empty states rebuilt per tab | Shared filter panel, entity-scope tabs, empty state |
| Digests are string templates, not AI | Digests and Riva Q&A backed by a real model |
| Alerts run only when you click Check now | Scheduled alerts with an email channel |

**What changed since revision 1:** Phase 0 is now five independently-shippable work items instead of one lump. Phase 3 (Action tools) now builds *before* Phase 2 (Competitors/Industry) — there's one person building this serially, and 03 finishes half-built features without new schema, making it the lower-risk next step. A baseline-commit step and a shared definition of done were added, since neither existed before.

---

## 01. Before you start

**Get the current work into git first.** Every brand-mentions file — `scripts/seed.ts`, `globals.css`, `settings/page.tsx`, `nav-rail.tsx`, `db.ts`, `x-api.ts`, `types/index.ts`, plus the entire new `src/app/brand`, `src/app/api/brand`, and `src/components/brand` trees — is still sitting **uncommitted directly on `main`**, unchanged since this plan started. Commit it as a baseline (one commit, or a few logical ones) before Phase 00 touches any of it. Without that, there's no history to diff against if a route split goes wrong, and no way to revert one work item without reverting the whole feature.

**Definition of done, for every work item below:**

1. `pnpm typecheck` and `pnpm lint` both clean
2. If the work item changes logic in `brand-queries.ts`, add a unit test alongside it — this repo already runs `src/lib/*.test.ts` via `pnpm test`; follow the existing `analytics.test.ts` pattern
3. Manual smoke test against the running dev server — the actual page, not just a green typecheck
4. One short-lived branch per work item (e.g. `brand/00-2-redirect-nav`), merged once its checklist passes — not one long branch for the whole phase
5. Run the full `pnpm test:e2e` suite once per *phase*, not per work item — it rebuilds the app and is too slow to run after every small change

---

## 02. Design direction

SocialSonar's UI/UX advantage isn't any single screen — it's a small set of patterns reused everywhere. Build these once in Phase 0 and every later phase gets them for free instead of re-inventing filters and empty states again.

**Routes, not tab state**
Every sidebar item should be its own URL. A single page swapping seven internal tabs can't be bookmarked, deep-linked from an alert, or opened in two browser tabs to compare views — all things a monitoring tool gets used for.
`/brand/[id]/analyze/competitors`, not `tab=analytics`

**One filter panel, everywhere**
Social Mentions, News Media, and (once built) Competitors and Industry all need the same right-hand rail: search, sort, platform/sentiment/emotion checkboxes, an "Advanced" disclosure. Build it once as a component that takes a scope, not four hand-rolled asides.
`<FilterPanel scope="mentions" />`

**My Brand / Industry / Competitors is one component**
SocialSonar reuses the identical feed and chart components across these three scopes — only the keyword set changes. That's the single highest-leverage build in this plan: it turns "add Competitors" and "add Industry" into wiring, not new screens.
`<EntityScopeTabs entity={brand|competitor|industry} />`

**Numbers stay computed, prose gets generated**
Mentions, reach, sentiment splits are counted from real rows and must never come from a model. Digest narratives, Riva's answers, and Executive Insight cards are the only places an LLM should touch the page — and only ever summarizing numbers computed elsewhere.
See Phase 04.

**Status is a shape, not just a word**
Crisis, high-impact, and sentiment already exist as boolean/enum fields in `brand_mentions` but mostly render as plain text. Give them a stripe, a chip, an icon — something scannable in a feed of fifty posts.
Reuse existing `--success` / `--destructive` / `--warning` tokens.

**Time range is its own axis**
The current "real data only" toggle answers a different question (seeded vs. synced) than a time-range selector does (this week vs. all time). Keep both — don't let one quietly absorb the other's job.
Top bar: All Time / 7d / 30d / 90d / Custom.

---

## 03. Target information architecture

Same five groups as the reference product, mapped onto what already exists in this codebase versus what's genuinely new.

**Overview**
- Overview — `/overview` — *redesign*

**Mentions**
- Social Media — `/mentions/social` — *redesign*
- News Media — `/mentions/news` — *redesign*

**Analyze**
- Social Media — `/analyze/social` — *redesign*
- Social Creators — `/analyze/creators` — *redesign*
- Competitors — `/analyze/competitors` — *new page*
- Industry — `/analyze/industry` — *new*

**Create**
- Campaigns — `/create/campaigns` — *redesign*
- Reports — `/create/reports` — *new*
- AI Digests — `/create/digests` — *redesign*
- Alerts — `/create/alerts` — *redesign*
- Export — `/create/export` — *new page*

**Configure**
- My Brand — `/settings` → Brand tab — *ships as-is*
- Industry — `/configure/industry` — *new*
- Competitors — `/configure/competitors` — *redesign*

---

## 04. The six phases, in build order

This is the part that changed most. Phase 00 is now five small work items instead of one big one, and Phase 03 has moved ahead of Phase 02 — there's one person building this serially, so "can run in parallel" wasn't a real option, and 03 closes out half-built features without needing new schema, which makes it the safer next step after 00–01.

### 00 — Foundation: routes & shared components
`build 1st` · `~1–1.5 wk`

Stop bolting features onto one tabbed page — but do it as a strangler-fig migration, not a rewrite. The old page keeps working until the new routes are proven, not a moment longer.

**UI/UX**
- Persistent header: brand name, time range, live-sync status dot
- Sidebar groups get section labels (Overview / Mentions / Analyze / Create / Configure)
- Keep the existing coral brand accent (`--brand-coral`) — no second accent for the new shell

**Why this order**
- Every later phase adds a page or a filter — there has to be somewhere correct for it to land first
- Splitting routes before extracting shared components would mean rebuilding the filter panel five times instead of once

**Work items**
- [ ] **00.0** Baseline commit — get the current uncommitted brand-mentions tree into git before anything else moves
- [ ] **00.1** Extract each tab's JSX into its own component under `components/brand/tabs/`; scaffold the new routes to import those same components. The old tabbed page keeps rendering identically — nothing user-facing changes yet
- [ ] **00.2** Redirect `/brand/[id]` → `/brand/[id]/overview`, point `nav-rail.tsx` at the five new sub-groups, delete the now-dead tab-switch code
- [ ] **00.3** Extract `<EmptyState/>` and swap the ~4 existing inline empty states onto it — lowest-risk component, do it first
- [ ] **00.4** Extract `<FilterPanel/>`; migrate Social Mentions onto it, verify, then migrate News Mentions
- [ ] **00.5** Top-bar time-range selector: new date-bounds option on `getBrandMentions`/`getBrandMentionStats`, unit-tested, kept fully independent of the existing `realOnly` toggle

Depends on: nothing · Unlocks: everything below

### 01 — Close the existing gaps
`build 2nd` · `~1 wk`

Several stats are already computed in `brand-queries.ts` but never rendered. Surface what's already there before building anything net-new — and use these as filler work if a Phase 00 item gets blocked, since all four are independent of each other and of Phase 00.

**Work items — any order, each its own PR**
- [ ] **01.1** News feed: render `crisisCount`, `highImpactCount`, `totalArticles` as filter chips + stat tiles — the API already returns them, this is pure UI
- [ ] **01.2** Social analytics: metric toggle on the trend chart (Net / Positive / Neutral / Negative) plus a platform filter
- [ ] **01.3** Campaigns: expose `starts_at`/`ends_at` as date inputs in the create form — the schema already stores them
- [ ] **01.4** Creators: promote to a ranked table with Unique Creators / Total Reach / Engagement Rate tiles

Depends on: 00 · Unlocks: 02, 03

### 03 — Action & output tools
`build 3rd` · `~1.5–2 wk`

Round out the Create group: scheduled alerts, a real export history, and Reports as a second face of the Digest engine rather than a parallel pipeline.

**Build**
- Alerts: recurring schedule on top of the existing manual Check now — no scheduler exists in this app yet, this is new infrastructure (see Section 07, Q1)
- Alerts: email channel — no SMTP/mail pipeline exists in this codebase either, confirmed by search; in-app first, email second, Slack/webhook later
- Export: promote the inline CSV button to its own page with an export history table (same pattern as `brand_digests`)
- Reports: a scheduled wrapper around `createBrandDigest()`'s existing engine — not a second generator

**UI/UX**
- Alert cards show their schedule ("Daily, 09:00") next to the existing filter summary
- Export page: search + "New export" action + history list, same empty-state convention as Campaigns

> **Moved ahead of Phase 02:** no new database tables, no new comparative UI — just finishing features that are already half-built. Lower risk, faster to ship, and it doesn't block Phase 02 or get blocked by it.

Depends on: 00, 01 · Unlocks: 04's cadence-based insight cards

### 02 — Competitors & Industry, for real
`build 4th` · `~1.5–2 wk`

Today a competitor is a name in a list. Turn it into a second keyword-tracked entity that reuses every component built for the brand itself.

**Build**
- Give each `brand_competitors` row its own keyword set (same shape as campaigns — no new table concept)
- New `brand_industry_monitors` table: same shape again, one per brand
- Build `<EntityScopeTabs/>` now (deliberately deferred from Phase 00 to here, so its interface is informed by this real data shape) and wire it into Mentions and News Media
- Side-by-side comparison view on `/analyze/competitors` reusing StatTile + BarBreakdown

**UI/UX**
- "Your Brand" card + competitor cards in a row, "+ Add competitor" as the last tile
- Empty state explains what unlocks (comparison, benchmarking) rather than just "no competitors yet"
- Industry starts with a single "Create Industry Monitor" CTA — same empty-state component from Phase 00

> **Comes after 03 on purpose:** two new tables and a new cross-entity UI pattern is the riskiest single build in this plan — do it once 00–01–03 have proven the shared components under real use, not before. Swap it ahead of 03 if competitor benchmarking is the more urgent business need.

Depends on: 00, 01 · Unlocks: richer Overview insight cards in 04

### 04 — The real AI layer
`build 5th` · `~2–3 wk`

The one part of this plan that's a genuinely new capability, not a UI gap: actual model-backed synthesis, scoped tightly so it can't invent numbers.

**Build**
- Replace the digest's string template with a real call: same computed stats payload, sent to a model for the narrative only — volume and sentiment numbers stay code-computed, never generated
- Ask Riva as scoped Q&A, not open chat: retrieve the in-view brand's stats/mentions, hand them as context, refuse to answer outside it
- Three Executive Insight cards (My Brand / Competitor / Industry) generated on the same cadence as Digests, cached — not re-generated per page view

**UI/UX**
- "Ask anything about your brand…" search bar with prompt chips, matching the reference doc's Overview pattern
- Every generated paragraph carries a visible "AI summary" label — keep the current digest's honesty convention once it's real AI

Depends on: 01, 02, 03 · Unlocks: nothing further, top of the stack

### 05 — Multi-brand & usage accounting
`build 6th` · `~1–1.5 wk`

Every route in this plan is already parameterized by `brandId` — this phase is mostly a missing "list brands" UI, not a schema change.

**Build**
- Brand switcher dropdown + "create new brand" flow in the sidebar
- Usage counters: keywords, mentions ingested, AI calls (once Phase 04 ships) — a workspace-limits row, not a full billing integration unless monetization is actually planned

**UI/UX**
- Account panel: identity, plan badge, a usage meter per counter — skip the trial-countdown badge unless there's a real trial policy behind it

> Can move earlier than 6th if a second brand is needed sooner than the AI layer — it only depends on Phase 00, not on 01–04.

Depends on: 00 · Unlocks: nothing else depends on this

---

## 05. At a glance

Sorted by build order this time, not by phase number — that's the whole point of the resequencing in Section 04.

| Order | Phase | Effort | Depends on | Unlocks |
|---|---|---|---|---|
| 1 | 00 — Foundation | 1–1.5 wk | — | 01–05 |
| 2 | 01 — Close gaps | 1 wk | 00 | 02, 03 |
| 3 | 03 — Action tools | 1.5–2 wk | 00, 01 | 04 |
| 4 | 02 — Competitors/Industry | 1.5–2 wk | 00, 01 | 04 |
| 5 | 04 — AI layer | 2–3 wk | 01, 02, 03 | — |
| 6 | 05 — Multi-brand | 1–1.5 wk | 00 | — |

---

## 06. Where to diverge from the reference

Matching the reference product's screens is the easy part. Three of its metrics don't have an honest data source in this app, and copying the screen without the data behind it just relocates the "stale data" problem from the seed script into the analytics.

> **⚠ Don't build Gender breakdown or Net Promoter Score on mention data**
>
> NPS is a survey metric — a 0–10 "would you recommend us" response. It cannot be derived from sentiment-classified social posts without inventing a mapping that looks precise and isn't. Gender is not reliably inferable from a handle or display name.
>
> Building either would repeat the exact failure already flagged in the seed-data review: a confident-looking number with no real signal behind it. Keep Health Score as the one social/sentiment composite; add a trend delta (↑ 6 pts vs. last period) instead of a second invented score.

> **⚠ Reputation / Authority score needs a real publisher dataset**
>
> A distinct "Highest Authority" or "Reputation Score" for news requires a domain-authority style data source this app doesn't have. Either license one (e.g. a domain-authority API) before building the feature, or keep a single Health Score shared across social and news rather than fabricating a second scale.

---

## 07. Open before build order 3 (Phase 03)

- **Q1** — What runs the recurring alert/report schedule? No cron or job runner exists in this app yet — needs a decision (in-process interval vs. an external scheduler) before Phase 03 starts.
- **Q2** — Does an Industry monitor need its own ingestion, or does it just re-filter the same ingested pool with a different keyword set? Assumed the latter in Phase 02 — confirm before building the table.
- **Q3** — What's the per-workspace budget for Phase 04's model calls? Riva and AI Digests both cost real tokens per use; needs a rate limit before it ships, not after.

---

*Revision 2: resequenced for one person building serially, Phase 00 broken into five independently-shippable work items, and a baseline commit added before any of it starts. Nothing here assumes parallel engineers or a big-bang rewrite — every work item is meant to leave the app in a working, deployable state.*
