#!/usr/bin/env bash
# CRE curve-yt-launch — HTTP trigger (keep running for desk pool requests).
#
# Stack (three terminals after Surfpool + deploy):
#   1  ./scripts/start-surfpool.sh && ./scripts/deploy-surfpool.sh
#   2  cd web && npx --yes tsx scripts/launch-backend.ts
#   3  ./scripts/run-cre-curve-yt-launch.sh --listen
#
# Desk: Request curve-YT pool → backend :8788 → CRE :2000 → executor → Surfpool
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRE_ROOT="$ROOT/cre/orange-cre"
WF="curve-yt-launch"

cd "$CRE_ROOT"

MODE="listen"
CONFIG=""
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --listen)
      MODE="listen"
      shift
      ;;
    --once)
      MODE="once"
      shift
      ;;
    --no-executor)
      CONFIG="$CRE_ROOT/$WF/config.staging.norelay.json"
      shift
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

ARGS=(workflow simulate "$WF" --target staging-settings)

if [[ -n "$CONFIG" ]]; then
  ARGS+=(--config "$CONFIG")
fi

if [[ "$MODE" == "listen" ]]; then
  ARGS+=(--listen)
  echo "CRE curve-yt-launch HTTP trigger on :2000 (Ctrl+C to stop)…"
else
  ARGS+=(--non-interactive --trigger-index 0)
  echo "CRE curve-yt-launch one-shot HTTP simulate…"
fi

cre "${ARGS[@]}" "${EXTRA[@]}"
