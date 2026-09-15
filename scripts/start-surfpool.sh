#!/usr/bin/env bash
set -euo pipefail

surfpool_db="${ARANCIO_SURFPOOL_DB:-./.surfpool/arancio.sqlite}"

exec surfpool start --network mainnet --db "$surfpool_db" --no-tui
