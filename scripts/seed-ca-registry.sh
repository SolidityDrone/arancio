#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/web"

exec npx --yes tsx scripts/seed-ca-registry.ts "$@"
