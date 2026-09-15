#!/usr/bin/env bash
set -euo pipefail

exec surfpool start --network mainnet --db ./.surfpool/arancio.sqlite --no-tui
