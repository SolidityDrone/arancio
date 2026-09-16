#!/usr/bin/env bash
set -euo pipefail

surfpool_db="${ARANCIO_SURFPOOL_DB:-:memory:}"
rpc_port="${ARANCIO_SURFPOOL_RPC_PORT:-8899}"

stop_surfpool() {
  if [[ "${ARANCIO_SURFPOOL_NO_KILL:-}" == "1" ]]; then
    return 0
  fi

  if pgrep -x surfpool >/dev/null 2>&1; then
    echo "Stopping existing surfpool (Ctrl-Z / old terminal sessions)…"
    pkill -TERM surfpool 2>/dev/null || true
    sleep 1
    pkill -KILL surfpool 2>/dev/null || true
  fi

  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti ":${rpc_port}" 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${rpc_port}/tcp" 2>/dev/null || true
    return 0
  fi

  if [[ -n "$pids" ]]; then
    echo "Freeing port ${rpc_port}…"
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    kill -KILL $pids 2>/dev/null || true
  fi
}

stop_surfpool

args=(
  start
  --network mainnet
  --db "$surfpool_db"
  --no-tui
)

# Default: skip runbook deploy (fast start). Deploy manually in Terminal B:
#   anchor deploy -p ca_registry --provider.cluster localnet
#   anchor deploy -p divstrip --provider.cluster localnet
if [[ "${ARANCIO_SURFPOOL_AUTO_DEPLOY:-}" == "1" ]]; then
  echo "Auto-deploy enabled (instant surfnet write)…"
  args+=(-y)
else
  args+=(--no-deploy)
fi

echo "Starting Surfpool → http://127.0.0.1:${rpc_port}"
echo "DB: ${surfpool_db}"
echo "Runs until Ctrl-C (this is normal — leave Terminal A open)."
if [[ "${ARANCIO_SURFPOOL_AUTO_DEPLOY:-}" != "1" ]]; then
  echo "Deploy programs in Terminal B, or set ARANCIO_SURFPOOL_AUTO_DEPLOY=1."
fi
echo ""

exec surfpool "${args[@]}"
