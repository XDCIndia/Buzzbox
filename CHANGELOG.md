# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased] - 2026-09-23

### Added
- X analytics now include impressions (`non_public_metrics.impression_count`) when a user-context `X_ACCESS_TOKEN` is set and the range is ≤ 7 days; graceful `null` plus a UI hint otherwise (#91).
- Real sync health: `syncAll()` records status/timestamp/duration (last success survives failures), exposed via `/api/settings` and rendered as "synced Xs ago" in the header (#95, fixes #69).
- Demo-brand protection: `brands.is_demo` flag (schema v3 with backfill), "This is demo data" banner on brand pages, auto-cleared on rename (#90, fixes #89).
- Agent chat deep links: `/agents/comms?conv=<id>` opens the referenced conversation and keeps the URL in sync (#95, fixes #67).

### Changed
- Content-item API falls back to `content_posts` (queue → posts) before returning 404 (#90, fixes #87).
- Buzz returns 412 with actionable guidance when Dicompute is unconfigured, matching the X-posting convention (#90, fixes #88); upstream provider errors surface concise status-based messages instead of the provider's raw HTML body (#95, fixes #51).
- Standalone asset copy and template export are Node scripts (no bash/rsync needed); the export keeps `.env.example` and drops test/runtime artifacts (fixes #107).
- Approvals taken on page routes now write `activity_log`, so the approvals history panel reflects them (#92, fixes #85).
- Toasts fire only after verified success; automations actions no longer leave buttons disabled after a failure (#93, fixes #66).
- `pnpm seed` runs the app migration instead of duplicated DDL (schema can no longer drift), targets the database the app reads, refuses on `NODE_ENV=production` or non-seed rows without `--force`, and requires interactive confirmation otherwise (fixes #102).
- SQLite migrations run each version step in its own transaction and stamp the version only on success, so a partial failure rolls back and retries on next boot instead of bricking the database (fixes #103).
- Corrupt `jobs.json` no longer resets to an empty schedule: reads throw a typed error, GETs surface degraded state, mutations answer 409, an explicit `POST /api/cron/jobs/reset` quarantines and reinitializes, and timestamped backups are pruned to the newest 10 (fixes #104).
- Submitted cron jobs must match a validated contract (known fields, size caps, cron-expression charset, 128k total; unknown keys stripped) instead of persisting `body.job` verbatim — `POST`/`PATCH /api/cron/jobs` answer 400 otherwise (fixes #105).
- Workspace paths resolve through symlinks with containment re-checked on real paths: escaping links answer 404 (reads/listings) or 400 (writes) without touching outside files, listings skip out-of-root links and never descend into symlinked dirs, and the write allowlist now matches the hidden-tree policy (`sessions`/`sandboxes`/`sandbox`) (fixes #106).
- Bare `pnpm lint` ignores nested build output and runtime/test artifacts (`.tmp/`, `test-results/`, `playwright-report/`, `state/`, `coverage/`, `**/.next/`), so stray worktree builds no longer fail the contributor gate (fixes #116).

### Fixed
- Agent-sessions cards link to the real `/agents/comms?conv=` route; dashboard uses the default brand id instead of a hardcoded UUID (#95, fixes #67).
- `PATCH /api/content` answers 404 for unknown ids instead of reporting success (fixes #135).
- `PATCH /api/content-item` validates status against the content enum, caps payloads at 128k, and writes the queue file atomically (fixes #134).
- Command-palette results deep-link to the lead record page instead of always landing on generic lists (fixes #138).
- Dashboard Pipeline card no longer shows a delta/sparkline borrowed from the discoveries metric (fixes #139).
- Dashboard `MetricColumn` no longer renders each KPI value block twice (fixes #117).
- Dialogs share a Modal shell with Escape-to-close, focus trap, initial focus, and scroll-lock (fixes #153).
- Lead notes stay open on failed saves instead of discarding the draft (fixes #154).
- Kanban cards move between stages with Left/Right arrow keys, announced via key shortcuts (fixes #155).
- Command palette exposes combobox/listbox semantics and opens via a shared action instead of a synthetic key event (fixes #156).
- CRM task-done, lead-create, and kanban-drop failures now surface error toasts (and refresh to server truth) instead of failing silently (fixes #118).
- Sync runs each source in isolation with per-source health, corrupt state files error instead of silently skipping, and the activity-log offset persists across restarts with truncation recovery (fixes #119).
- Brand mention sync fans out over all keywords (capped at five) with providers running concurrently, answers 200/207/502 honestly instead of always 200, and truncates provider errors to markup-free single lines (fixes #121).
- X publishing is serialized per content item in a new `x_publish_claims` table (schema v4): concurrent approves get 409 instead of double-posting, completed tweet ids make crash-retries finalize without reposting, stale claims expire after 5 minutes, and the budget check runs inside a publish mutex (fixes #120).
- Production build uses the default (Turbopack) builder instead of the pinned `--webpack` flag, which crashed on Windows scanning a protected home-dir junction; no webpack-specific configuration existed to preserve (fixes #108, unblocks #109).
- List reads (`content_posts`, `leads`, `sequences`, `suppression`, `experiments`, `learnings`, CRM list) cap at 200 rows like the other capped queries (fixes #133).
- CRM lead-detail poll no longer clobbers in-progress edits (dirty latch on the next-action date; hydration skips open editors) (#95, fixes #37).
- Chat session sync rebuilt: byte-accurate offset resumption, entry-id idempotency, fixed the never-matching cron-title regex (#93, fixes #60).
- CSRF origin check treats `127.0.0.1` and `localhost` as equivalent at the same scheme+port; cross-site, other ports, and scheme changes still rejected (#92, fixes #86).
- Mission-control sends check the cooldown/cap and record the send in one IMMEDIATE transaction, so concurrent requests serialize (losers get 429) instead of each spawning a 120-second agent child (fixes #168).
- Agent-chat sends cap `content` at 4000 chars like buzz, `conversation_id` at 200, agent/`to` fields at 100, and allowlist chat `message_type` — oversize or unknown values answer 400 instead of bloating the DB or blowing up spawned child args (fixes #169).
- Kanban drops onto clipped columns, gaps, and container padding dispatch at the board level (direct column hit, else nearest column at the drop height) instead of silently doing nothing; proven by a Playwright drag test that fails without the fix (fixes #173).
- Brand Alerts/Campaigns create forms toast "name is required" on empty submits instead of silently ignoring the click; the APIs also trim names so whitespace-only values answer 400 (fixes #174).
- Brand alert "Check now" surfaces the API error (or a generic failure line) instead of rendering "undefined matches" when the check fails (fixes #178).
- Mobile nav sheet and header menus (quick-create, data-status, notifications) close on Escape via a shared `useDismiss` hook instead of ignoring it; outside-click dismissal is unchanged (fixes #175, fixes #176).
- Missing memory-alerts reports answer 200 with an empty `configured: false` payload (like the sibling memory routes) instead of a permanent 404 the page polls every minute; the section renders an actionable empty state (fixes #177).

### Security
- Facebook Page access token moved from URL query string to `Authorization: Bearer` header (#93, fixes #84); same fix applied to both Threads API call sites (#94).
- Missing-config errors are typed (412/503) instead of surfacing as 500s (#90, fixes #88; telegram webhook included).
- Password changes (admin reset and `AUTH_PASS` rotation) invalidate all of the user's sessions (fixes #130).
- Post-OAuth redirects accept same-origin absolute paths only, closing the protocol-relative open redirect (fixes #131).
- `GET /api/deploy-status` requires the `manage_system` capability (admin-only) instead of any login (fixes #136).
- Cookie decoding never throws: malformed session cookies are treated as absent (401 / proceed to login / clear on logout) instead of 500ing into an unrecoverable lockout (fixes #149).
- Agent subprocess timeouts reject instead of resolving truncated output as success, and child output is capped at 256k per stream (fixes #151).
- Appending to an unreadable state file is refused instead of replacing it with a single row (fixes #148).
- Buzz accepts `x` (normalizing legacy `twitter`) for AI-drafted posts so approvals actually publish (fixes #150).
- Brand alert checks notify and advance their watermark in one transaction instead of stamping first (fixes #152).
- Baseline security headers (CSP, HSTS, framing, MIME-sniff, referrer) on every route, asserted in E2E (fixes #137).
- Provider upstream errors log bodies server-side and throw status-only messages instead of embedding response text (fixes #157).
- `POST /api/buzz` caps messages at 4000 chars and rate-limits callers (20/min per IP) since each request fans out into paid LLM calls (fixes #132).
- `GET /api/dicompute-test` now requires the `manage_system` capability (admin-only), is rate-limited per IP (10/min), and maps missing-provider/upstream failures to 412/502 instead of echoing raw errors; new coverage test asserts every non-auth API route references an auth guard (fixes #99).
- Host-lock parsing handles bracketed/bare IPv6 loopback (`[::1]`, `::1`) and normalizes case; documented that `HERMES_HOST_LOCK` is a best-effort header check with the listen address (`HOSTNAME=127.0.0.1`) plus firewall as the real boundary (fixes #100).
- Brand-child mutations (alert/campaign/competitor deletes, alert checks, mention reads/patches) are scoped to the URL `brandId` and answer 404 on mismatch, closing the cross-brand IDOR (fixes #101).
- Last-admin demotions and deletes re-check the admin count inside the same IMMEDIATE transaction as the write, so concurrent requests cannot both pass the guard and leave zero admins (fixes #165).
- Privileged user actions (create, role change, password reset, delete, OAuth login-request approve/deny) append actor/action/target rows to `audit_log`; failed mutations and password material are never recorded (fixes #170).
- Rate limits no longer trust `X-Forwarded-For` alone: IP parsing is centralized and capped, and the paid-LLM routes (`buzz`, `dicompute-test`) add a per-user bucket beside the IP bucket, so rotating the header cannot mint fresh quota (fixes #172).

### Closed (superseded/stale)
- #50 (Turbopack `/login` hang) — non-reproducible on Next 16.1.6 after the #74 frontend rewrite; closed with an evidence battery.

## [Unreleased] - 2026-09-21

### Added
- Approvals history panel now reflects real approval/rejection events (#83, fixes #39).
- `applied_to` JSON from learnings is parsed defensively; malformed rows no longer crash `/experiments` (#45, +5 tests).
- Cron job mutations are serialized with a process-level lock, preventing lost updates from concurrent writes (#46, +1 test).
- Sync reconciliation preserves experiments and learnings rows instead of delete-all-and-resync (#44, +10 tests).

### Changed
- CRM list refetches immediately on filter change instead of waiting for the next poll tick (#73).

### Fixed
- Duplicate SVG gradient IDs across multiple `StatCard` sparklines (#72).

### Security
- Instagram API access token moved from URL query string to `Authorization: Bearer` header (#82, fixes #63; recreates #71 with author credit).

### Closed (superseded/stale)
- #49, #52 (set-state-in-effect lint) — resolved by the #74 frontend rewrite; lint passes with `--max-warnings 0`.

## [0.2.0] - 2026-03-04

### Added
- MIT release scaffolding (`LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, third-party notices).
- Playwright E2E baseline and CI gates for unit + E2E checks.

### Changed
- Added route-level API auth checks for defense-in-depth on protected routes.
- Added configurable host lock (`HERMES_HOST_LOCK`) with secure local-first default for OpenClaw workflows.
- Hardened template safety by removing org-specific residue and sanitizing seeded/demo data.

### Security
- Remediated production dependency audit findings via `minimatch` override and verified clean `pnpm audit`.
