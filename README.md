# arancio / orange

Solana workspace for Stocklana: corporate-action registry + ERC-4626-style vault
scaffolding. DivStrip (PT/YT) builds on `ca_registry`.

## Toolchain

- Anchor CLI: 1.1.2
- Solana CLI: 3.1.10
- Surfpool: 1.5.0
- Node.js with Yarn 1.x

```bash
yarn install
```

## Local Test RPC

```bash
./scripts/start-surfpool.sh
```

Tests use `ARANCIO_RPC_URL` when set, otherwise `http://127.0.0.1:8899`.

```bash
# Workspace smoke + immutable vault config
yarn mocha tests/arancio.ts --grep "workspace smoke"

ARANCIO_SURFPOOL_DB=:memory: ./scripts/start-surfpool.sh
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha -t 1000000 tests/arancio.ts \
  --grep "configuration|named vault|immutable"

# CA registry + CRE sync
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha -t 180000 tests/ca-registry.ts

yarn test:anchor
```

## Programs

| Program | Role |
|---------|------|
| `ca_registry` | On-chain CA history (kind, cum factors, yield nonces) fed by CRE |
| `divstrip` | Wrap xStock → PT + YT for a yield-nonce window; unwrap / redeem |
| `arancio` | Named vault + share mint (ERC-4626 custody deposit) |

## DivStrip web desk

Stocklana-styled landing + strip UI (Phantom / Solflare / Torus):

```bash
# Terminal A — Surfpool
./scripts/start-surfpool.sh

# Terminal B — deploy programs
anchor build
anchor deploy -p ca_registry --provider.cluster localnet
anchor deploy -p divstrip --provider.cluster localnet

# Terminal C — site
yarn web
# or: cd web && npm install && npm run dev
# → http://127.0.0.1:5173
```

Point the wallet RPC at `http://127.0.0.1:8899` (Phantom: developer settings /
custom RPC). Landing explains the split; `/app` lists xStock / PT / YT and runs
`wrap` when registry + strip market exist.

### Meteora DBC → DAMM v2 (feat/damm-meteora)

After wrap, **Launch YT on Meteora DBC** builds an equity-strip curve via
`@meteora-ag/dynamic-bonding-curve-sdk`:

- initial market cap ≈ f(fair coupon `1 − Yₛ/Yₜ`)
- migration market cap ≈ 10× initial
- `MigrationOption.MET_DAMM_V2`, quote = WSOL
- pool address stored locally; link to https://migrator.meteora.ag

```bash
cd web && npm install && npm run dev
```

Requires Surfpool/mainnet-fork RPC so the DBC program
`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` is reachable.

Kamino lending is **not** integrated. Jupiter program id remains in the arancio
address book for a later swap path.