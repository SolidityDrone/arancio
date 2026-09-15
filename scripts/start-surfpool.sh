#!/usr/bin/env bash
set -euo pipefail

surfpool_db="${ARANCIO_SURFPOOL_DB:-:memory:}"

exec surfpool start --network mainnet --db "$surfpool_db" --no-tui
