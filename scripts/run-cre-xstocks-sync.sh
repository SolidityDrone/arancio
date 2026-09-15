#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRE_ROOT="$ROOT/cre/orange-cre"

cd "$CRE_ROOT"

ARGS=(
  workflow simulate xstocks-ca-sync
  --target staging-settings
  --non-interactive
  --trigger-index 0
)

if [[ "${1:-}" == "--broadcast" ]]; then
  ARGS+=(--broadcast)
fi

cre "${ARGS[@]}"
