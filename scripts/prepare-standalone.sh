#!/usr/bin/env bash
# Thin POSIX wrapper: the implementation lives in prepare-standalone.mjs so
# `pnpm build` (postbuild) also works on stock Windows, which has no
# bash/rsync requirement for this step anymore (#107).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/prepare-standalone.mjs"
