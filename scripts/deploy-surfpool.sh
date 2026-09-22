#!/usr/bin/env bash
# Terminal B — point CLI at Surfpool, deploy programs, optionally fund a desk wallet.
#
# Prerequisite: Surfpool running in another terminal:
#   ./scripts/start-surfpool.sh
#
# Usage:
#   ./scripts/deploy-surfpool.sh
#   ./scripts/deploy-surfpool.sh <PHANTOM_PUBKEY>
#   ARANCIO_FUND_WALLET=<pubkey> ./scripts/deploy-surfpool.sh
#
# Environment:
#   ARANCIO_RPC_URL          RPC URL (default: http://127.0.0.1:8899)
#   ARANCIO_SKIP_BUILD=1     Skip anchor build
#   ARANCIO_SKIP_AIRDROP=1   Skip solana airdrop for deploy keypair
#   ARANCIO_SKIP_FUND=1      Skip wallet funding even if pubkey is set
#   ARANCIO_SKIP_REGISTRY_SEED=1  Skip ca_registry PDA init + CA sync
#   ARANCIO_SEED_SYMBOLS     Comma subset for registry seed, e.g. KOx,XOMx
#   ARANCIO_DEPLOY_ARANCIO=1 Also deploy optional arancio program
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

rpc_url="${ARANCIO_RPC_URL:-http://127.0.0.1:8899}"
fund_wallet="${1:-${ARANCIO_FUND_WALLET:-}}"

CA_REGISTRY_ID="2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z"
DIVSTRIP_ID="A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz"

usage() {
  cat <<EOF
Usage: $(basename "$0") [WALLET_PUBKEY]

Deploy ca_registry + divstrip to local Surfpool and optionally fund a desk wallet.

Start Surfpool first (Terminal A):
  ./scripts/start-surfpool.sh

Then run this script (Terminal B):
  ./scripts/deploy-surfpool.sh <PHANTOM_PUBKEY>

Environment:
  ARANCIO_RPC_URL          RPC endpoint (default: http://127.0.0.1:8899)
  ARANCIO_FUND_WALLET      Wallet to fund (alternative to positional arg)
  ARANCIO_SKIP_BUILD=1     Skip anchor build
  ARANCIO_SKIP_AIRDROP=1   Skip deploy-key airdrop
  ARANCIO_SKIP_FUND=1      Skip wallet funding
  ARANCIO_SKIP_REGISTRY_SEED=1  Skip ca_registry PDA init + CA sync
  ARANCIO_SEED_SYMBOLS     Comma subset for registry seed, e.g. KOx,XOMx
  ARANCIO_DEPLOY_ARANCIO=1 Also deploy arancio program
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

wait_for_rpc() {
  local attempts=60
  echo "Waiting for Surfpool at ${rpc_url}…"
  for ((i = 1; i <= attempts; i++)); do
    if curl -sf "${rpc_url}" \
      -X POST \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      | grep -q '"ok"'; then
      echo "RPC healthy."
      return 0
    fi
    sleep 2
  done
  echo "error: ${rpc_url} not reachable after ${attempts} attempts." >&2
  echo "Start Surfpool first: ./scripts/start-surfpool.sh" >&2
  exit 1
}

deploy_program() {
  local name="$1"
  echo ""
  echo "Deploying ${name}…"
  anchor program deploy -p "${name}" --provider.cluster localnet
}

verify_program() {
  local program_id="$1"
  local label="$2"
  if solana program show "${program_id}" -u "${rpc_url}" >/dev/null 2>&1; then
    echo "  ✓ ${label} (${program_id})"
  else
    echo "error: ${label} not found at ${program_id}" >&2
    exit 1
  fi
}

wait_for_rpc

echo ""
echo "Pointing Solana CLI at Surfpool…"
solana config set --url "${rpc_url}"
solana config get

if [[ "${ARANCIO_SKIP_AIRDROP:-}" != "1" ]]; then
  echo ""
  echo "Funding deploy keypair (Surfpool-only SOL)…"
  solana airdrop 100 || true
  solana balance
fi

if [[ "${ARANCIO_SKIP_BUILD:-}" != "1" ]]; then
  echo ""
  echo "Building programs…"
  anchor build -p ca_registry
  anchor build -p divstrip
  if [[ "${ARANCIO_DEPLOY_ARANCIO:-}" == "1" ]]; then
    anchor build -p arancio
  fi
fi

echo ""
echo "Deploying to localnet (Surfpool)…"
deploy_program ca_registry
deploy_program divstrip
if [[ "${ARANCIO_DEPLOY_ARANCIO:-}" == "1" ]]; then
  deploy_program arancio
fi

echo ""
echo "Verifying deployments…"
verify_program "${CA_REGISTRY_ID}" "ca_registry"
verify_program "${DIVSTRIP_ID}" "divstrip"

echo ""
echo "Syncing program IDs to web…"
(cd web && npx --yes tsx scripts/sync-program-ids.ts)

if [[ "${ARANCIO_SKIP_REGISTRY_SEED:-}" != "1" ]]; then
  echo ""
  echo "Seeding ca_registry PDAs for desk xStocks (deploy key authority)…"
  ARANCIO_RPC_URL="${rpc_url}" "$ROOT/scripts/seed-ca-registry.sh"
else
  echo ""
  echo "Skipping registry seed (ARANCIO_SKIP_REGISTRY_SEED=1)."
fi

if [[ -n "${fund_wallet}" && "${ARANCIO_SKIP_FUND:-}" != "1" ]]; then
  echo ""
  echo "Funding desk wallet ${fund_wallet}…"
  ARANCIO_RPC_URL="${rpc_url}" ./scripts/fund-surfpool-wallet.sh "${fund_wallet}"
elif [[ -z "${fund_wallet}" ]]; then
  echo ""
  echo "No wallet pubkey — skip funding."
  echo "Fund later: ./scripts/fund-surfpool-wallet.sh <PHANTOM_PUBKEY>"
fi

echo ""
echo "Done. Programs deployed on ${rpc_url}"
echo "  ca_registry  ${CA_REGISTRY_ID}"
echo "  divstrip     ${DIVSTRIP_ID}"
