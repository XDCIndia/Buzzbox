#!/usr/bin/env bash
# Thin POSIX wrapper: the implementation lives in template-export.mjs so the
# export also works on stock Windows via `node scripts/template-export.mjs`
# (no rsync or /tmp required) (#107).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/template-export.mjs" "$@"
