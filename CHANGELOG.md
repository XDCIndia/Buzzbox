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
- Approvals taken on page routes now write `activity_log`, so the approvals history panel reflects them (#92, fixes #85).
- Toasts fire only after verified success; automations actions no longer leave buttons disabled after a failure (#93, fixes #66).

### Fixed
- Agent-sessions cards link to the real `/agents/comms?conv=` route; dashboard uses the default brand id instead of a hardcoded UUID (#95, fixes #67).
- CRM lead-detail poll no longer clobbers in-progress edits (dirty latch on the next-action date; hydration skips open editors) (#95, fixes #37).
- Chat session sync rebuilt: byte-accurate offset resumption, entry-id idempotency, fixed the never-matching cron-title regex (#93, fixes #60).
- CSRF origin check treats `127.0.0.1` and `localhost` as equivalent at the same scheme+port; cross-site, other ports, and scheme changes still rejected (#92, fixes #86).

### Security
- Facebook Page access token moved from URL query string to `Authorization: Bearer` header (#93, fixes #84); same fix applied to both Threads API call sites (#94).
- Missing-config errors are typed (412/503) instead of surfacing as 500s (#90, fixes #88; telegram webhook included).

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
