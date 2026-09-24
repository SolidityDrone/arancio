# Reproduce the full stack on Surfpool

End-to-end guide: mainnet-backed Surfpool → deploy programs → seed `ca_registry`
→ run the DivStrip + Meteora web desk → sign txs from Phantom.

Use **three terminals** (Surfpool, deploy/seed, web). All commands assume repo root:

```bash
cd /path/to/orange
```

---

## Prerequisites

| Tool | Version (pinned in repo) |
|------|--------------------------|
| Anchor | 1.1.2 |
| Solana CLI | 3.1.10 |
| Surfpool | 1.5.0 |
| Node + npm | 18+ |
| Chainlink CRE CLI | **Optional** — [install](https://docs.chain.link/cre/reference/cli); **not needed** if you use `./scripts/deploy-surfpool.sh` (registry seed) |

```bash
npm install
npm install --prefix web
```

**CRE:** The default desk path seeds `ca_registry` on deploy — Chainlink does not need to be running (same as the hackathon demo). Use CRE only for `cre workflow simulate` / `./scripts/run-cre-xstocks-sync.sh` ([`xstocks-ca-sync` README](cre/orange-cre/xstocks-ca-sync/README.md)).

Deploy wallet (default): `~/.config/solana/id.json`

Program IDs (localnet / `Anchor.toml`):

| Program | ID |
|---------|-----|
| `ca_registry` | `2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z` |
| `divstrip` | `A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz` |
| `arancio` | `FwYP85cYksB7gHWe67CEUcYEFokikEUYGmf9ZGt8Qqgf` |
| Meteora DBC (mainnet fork) | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` |

Demo xStock mint (KOx): `XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ`

---

## Terminal A — start Surfpool

Surfpool forks **mainnet** state locally. Meteora DBC and xStock token accounts
from mainnet are available on the fork.

```bash
# Persistent DB (recommended). Delete to reset the fork.
rm -f /tmp/orange-surfpool.sqlite

ARANCIO_SURFPOOL_DB=/tmp/orange-surfpool.sqlite ./scripts/start-surfpool.sh
```

The wrapper **skips auto-deploy by default** (fast start). Deploy in Terminal B
with `anchor deploy`, or opt in to runbook deploy:

```bash
# Optional: auto-deploy all three programs on start (instant surfnet writes)
anchor build -p ca_registry && anchor build -p divstrip && anchor build -p arancio
ARANCIO_SURFPOOL_AUTO_DEPLOY=1 ARANCIO_SURFPOOL_DB=/tmp/orange-surfpool.sqlite \
  ./scripts/start-surfpool.sh
```

Surfpool is a long-running process — **no prompt and no exit is normal**. You
should see startup lines, then logs as slots advance. Leave Terminal A open.

Leave running. RPC: **`http://127.0.0.1:8899`**

Health check (optional):

```bash
curl -s -X POST http://127.0.0.1:8899 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
# → {"result":"ok",...}
```

---

## Terminal B — CLI, fund, build, deploy

### Point Solana CLI at Surfpool

```bash
solana config set --url http://127.0.0.1:8899
solana config get
```

### Fund the deploy key (Surfpool only — not mainnet)

```bash
solana airdrop 100
solana balance
```

This SOL exists **only on your local fork**. It is not real mainnet SOL.

### Build and deploy

```bash
anchor build -p ca_registry
anchor build -p divstrip
anchor build -p arancio   # optional vault program

anchor deploy -p ca_registry --provider.cluster localnet
anchor deploy -p divstrip --provider.cluster localnet
anchor deploy -p arancio --provider.cluster localnet   # optional
```

Verify programs:

```bash
solana program show 2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z
solana program show A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz
```

---

## Seed `ca_registry` for KOx (required for Split in the app)

Deploy alone is **not** enough. `/app` → **Split** checks for a registry PDA
for the selected xStock mint. Without it you get:

> `No ca_registry for KOx. Deploy registry + backfill on local Surfpool first.`

### Option 1 — integration test (fastest)

Initializes the real KOx mint registry and syncs at least one CA event:

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 180000 \
  tests/ca-registry.ts --grep "CRE dry-run"
```

Requires `cre` CLI installed (`cre/orange-cre/`). The test creates the registry
if missing and applies one sync payload.

### Option 2 — CRE broadcast (incremental backfill)

From repo root, after registry exists:

```bash
./scripts/run-cre-xstocks-sync.sh              # dry-run
./scripts/run-cre-xstocks-sync.sh --broadcast  # one oldest event per run
```

Repeat `--broadcast` to backfill more history. See
[`cre/orange-cre/xstocks-ca-sync/README.md`](cre/orange-cre/xstocks-ca-sync/README.md).

### Option 3 — full test suite

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 180000 \
  tests/ca-registry.ts tests/divstrip.ts
```

---

## Terminal C — web desk

```bash
npm run web
# → http://127.0.0.1:3000
```

- `/` — landing (PT/YT explainer + Meteora use case)
- `/app` — **Split → Launch YT on Meteora DBC → DAMM v2**

Optional RPC override:

```bash
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 npm run web
```

Default is already `http://127.0.0.1:8899` (`web/src/lib/markets.ts`).

---

## Wallet setup — can you send txs from the app?

**Yes, with Phantom or Solflare.** The desk calls `wallet.sendTransaction` for
Split and Launch YT. You will get a wallet popup to approve each tx.

**MetaMask is not wired in.** Adapters are Phantom, Solflare, and Torus only.
Use Phantom or Solflare for Solana signing.

### 1. Connect wallet

Click **Select Wallet** in the nav → choose Phantom or Solflare.

### 2. Point the wallet at Surfpool

In Phantom: **Settings → Developer Settings → Custom RPC** (or add network):

| Field | Value |
|-------|-------|
| RPC URL | `http://127.0.0.1:8899` |
| Chain | Solana |

**WSL2:** if the browser runs on Windows but Surfpool runs in WSL, `127.0.0.1`
in the browser is Windows, not Linux. Use the WSL IP instead:

```bash
hostname -I | awk '{print $1}'
# e.g. http://172.22.123.45:8899
```

Set that URL in Phantom **and** optionally `VITE_RPC_URL` when starting the web
app so both sides agree.

### 3. Fund the **browser** wallet on the fork

The deploy key airdrop does **not** fund Phantom. Fund your Phantom pubkey with
SOL **and every desk xStock** (Surfpool cheatcodes):

```bash
./scripts/fund-surfpool-wallet.sh <YOUR_PHANTOM_PUBKEY>
# subset only:
ARANCIO_FUND_SYMBOLS=KOx,XOMx ./scripts/fund-surfpool-wallet.sh <YOUR_PHANTOM_PUBKEY>
```

Defaults: **100 SOL** + **100 units** of each curated xStock in the app sidebar.
Override with `ARANCIO_FUND_SOL`, `ARANCIO_FUND_TOKENS`, `ARANCIO_RPC_URL`.

Manual SOL-only fallback:

```bash
solana airdrop 10 <YOUR_PHANTOM_PUBKEY> -u http://127.0.0.1:8899
```

You need SOL for tx fees and account rent (init strip market, create series,
Meteora DBC config/pool).

### 4. xStock balance for Split

Surfpool mirrors mainnet token balances. If your Phantom address already holds
KOx on mainnet, the Token-2022 ATA may appear on the fork when first used.

If you have **0 KOx** on the fork, Split will fail at `wrap` even with SOL and
a live registry. Options:

- Use a wallet pubkey that holds KOx on mainnet (fork copies state), or
- Manually mint/transfer test tokens on the fork (advanced; not covered here).

---

## What each app action needs

| Action | On-chain requirements | Wallet needs |
|--------|----------------------|--------------|
| **Split into PT + YT** | `ca_registry` for mint; app auto-inits strip market + series | SOL + xStock (e.g. KOx) balance |
| **Launch YT on Meteora DBC** | Meteora DBC program on fork; prior Split optional but sets window | SOL (config + pool rent); quote = WSOL |
| **View landing / markets table** | None | None |

After Split, **Launch YT** builds a DBC curve from fair coupon
`1 − cum_y(start)/cum_y(target)`, stores pool info in `localStorage`, and links
to [Meteora migrator](https://migrator.meteora.ag) for DAMM v2 graduation.

---

## Verification checklist

```bash
# Programs deployed
solana program show A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz -u http://127.0.0.1:8899

# KOx registry PDA exists (seed: ["registry", KOx mint])
# 2pSKY3rEiGc6UQsQJLFXWzSaTd22irR5zZH6Kj5NSuLW — after init + sync

# Integration tests
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 180000 \
  tests/ca-registry.ts tests/divstrip.ts

# CRE Go tests
cd cre/orange-cre && go test ./xstocks-ca-sync/ -count=1

# Web production build
npm --prefix web run build
```

In the browser:

1. Connect Phantom on custom RPC `http://127.0.0.1:8899` (or WSL IP).
2. Open `http://127.0.0.1:3000/app`.
3. Split → approve Phantom popup → status shows tx signature prefix.
4. Launch YT → second Phantom popup → pool address in UI.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `No ca_registry for KOx` | Registry not initialized for mint | Run seed step above |
| Phantom tx fails instantly | Wallet on mainnet RPC, not Surfpool | Custom RPC → `127.0.0.1:8899` |
| Connection refused from browser (WSL) | Browser cannot reach Linux localhost | Use WSL IP for RPC |
| `This program may not be used for executing instructions` | Program not deployed on fork | Re-run `anchor deploy` |
| Wrap fails: insufficient funds | No xStock in wallet ATA | Use address with fork KOx balance |
| DBC launch fails | DBC program missing / RPC wrong | Confirm Surfpool `--network mainnet` |
| MetaMask does not appear / cannot sign | Not in wallet adapter list | Use Phantom or Solflare |
| Phantom “cannot simulate” / Split fails · `Failed to fetch accounts from remote` | Surfpool JIT-fetch from mainnet failed (offline, firewall, or public RPC down) | Surfpool needs internet to hydrate fork accounts. Retry when `curl https://api.mainnet-beta.solana.com` works. Phantom **Local Net** must be `http://127.0.0.1:8899` (same as app). Split is **1 signature** (series + ATAs + wrap batched); first split on a mint adds **one** extra sig for `initializeStrip` |
| Surfpool “stuck” / no output for minutes | Old DB is huge, or auto-deploy running hundreds of txs | Default start skips deploy. If DB is ~2GB, `rm -f /tmp/orange-surfpool.sqlite` and restart. Use `ARANCIO_SURFPOOL_AUTO_DEPLOY=1` only when you want runbook deploy |
| `Select the programs to deploy` prompt | Auto-deploy enabled without `-y` | Set `ARANCIO_SURFPOOL_AUTO_DEPLOY=1` (script passes `-y`); or press **Enter** to accept all checked programs |

---

## Quick copy-paste (minimal happy path)

```bash
# Terminal A
cd /path/to/orange
rm -f /tmp/orange-surfpool.sqlite
ARANCIO_SURFPOOL_DB=/tmp/orange-surfpool.sqlite ./scripts/start-surfpool.sh

# Terminal B
cd /path/to/orange
solana config set --url http://127.0.0.1:8899
solana airdrop 100
anchor build -p ca_registry && anchor build -p divstrip
anchor deploy -p ca_registry --provider.cluster localnet
anchor deploy -p divstrip --provider.cluster localnet
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 180000 \
  tests/ca-registry.ts --grep "CRE dry-run"
./scripts/fund-surfpool-wallet.sh <PHANTOM_PUBKEY>

# Terminal C
cd /path/to/orange && npm run web
# Phantom → custom RPC http://127.0.0.1:8899 → http://127.0.0.1:3000/app
```

---

## Related docs

- [`README.md`](README.md) — program overview
- [`cre/orange-cre/xstocks-ca-sync/README.md`](cre/orange-cre/xstocks-ca-sync/README.md) — CRE CA sync only (Meteora is desk-side)
