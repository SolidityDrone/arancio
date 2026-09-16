#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

exec ./node_modules/.bin/ts-node --transpile-only "$ROOT/scripts/fund-surfpool-wallet.ts" "$@"
