# xStocks CA Sync (CRE → ca_registry)

Cron workflow that fetches xStocks v2 corporate-action history/upcoming for a
configured symbol (default `KOx`), maps `caType` → `kind`, and writes one
`SyncEvent` per run via Keystone `WriteReport` into `ca_registry.on_report`.

## Local Surfpool loop

From the monorepo root (`orange/`):

```bash
# 1) Start mainnet-backed Surfpool
ARANCIO_SURFPOOL_DB=/tmp/orange-surfpool.sqlite ./scripts/start-surfpool.sh

# 2) Build + deploy ca_registry
anchor build -p ca_registry
anchor deploy -p ca_registry --provider.cluster localnet

# 3) Integration tests (factor math, full KOx backfill, CRE dry-run)
ARANCIO_RPC_URL=http://127.0.0.1:8899 ./node_modules/.bin/ts-mocha \
  -p ./tsconfig.json -t 180000 tests/ca-registry.ts
```

Bulk history uses authority `sync_events` with all API events that have both
multipliers. CRE itself writes **one oldest complete event per run**
(`backfillMode: "oldest"`, `maxEventsPerWrite: 1`) because Solana reports are
capped at ~265 bytes.

## CRE simulate

From `cre/orange-cre/`:

```bash
# Dry-run (no chain broadcast)
cre workflow simulate xstocks-ca-sync \
  --target staging-settings --non-interactive --trigger-index 0

# Broadcast to local Surfpool (registry must already be initialized for KOx
# with forwarder state jhCjuD4Z3V7HeSUChMRpkRwpw6B9yC63mxDMv8SdLNX)
cre workflow simulate xstocks-ca-sync \
  --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

Or via helper:

```bash
./scripts/run-cre-xstocks-sync.sh
./scripts/run-cre-xstocks-sync.sh --broadcast
```

Expect `TX_STATUS_SUCCESS` and a non-empty `PayloadBase64`. With `--broadcast`,
expect a real `TxSignature` and `eventCount >= 1` on the KOx registry PDA
`2pSKY3rEiGc6UQsQJLFXWzSaTd22irR5zZH6Kj5NSuLW`.

## Kind mapping

| API `caType` | kind | Factor effect |
|--------------|------|---------------|
| CashDividend / StockDividend | Yield (0) | advances `cum_y` + `yield_nonce` |
| ForwardSplit / ReverseSplit | Supply (1) | advances `cum_s` only |
| SpinOff | Other (2) | recorded; factors unchanged |

## Option A — YT launch after Yield write

When `launchYtOnYield` is true and the event written this run is `kind=Yield`,
the same cron handler immediately `WriteReport`s a `LaunchYtReport` into
`divstrip.on_report`. That instruction only emits `YtLaunchRequested`
(`[current_yield_nonce, current + lock_nonces]`); it does **not** create the
Meteora DBC pool (pool create needs keypair signers CRE cannot supply).

Desk / crank listens for `YtLaunchRequested` and runs DBC→DAMM via the web
helpers. Launch failure is soft: CA sync stays successful and
`ytLaunchError` is returned in the workflow result.

## Config

See `config.staging.json` / `config.production.json`:

- `schedule`: `0 0 */6 * * *` (every 6 hours)
- `maxEventsPerWrite`: `1`
- `backfillMode`: `oldest`
- `computeLimit`: `290000`
- `launchYtOnYield`: `true` (chain LaunchYt after Yield CA writes)
- `lockNonces`: `2` (YT window length; `0` → market default / workflow default 2)
- `divstripProgramId`: DivStrip program (receiver for LaunchYt WriteReport)
