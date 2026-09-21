# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

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
