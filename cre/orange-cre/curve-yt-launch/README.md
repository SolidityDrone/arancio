# curve-yt-launch (CRE HTTP trigger)

Desk pool launch path:

```
Frontend  POST /api/request-pool
Backend   POST http://127.0.0.1:2000   (CRE HTTP trigger --listen)
CRE       compute CurvePolicy
CRE       POST /internal/execute       (backend tx executor, authority key)
Executor  Meteora DBC + register_curve_launch on Surfpool
Frontend  shows registered pool
```

## Local stack

```bash
# Terminal 1 — chain
./scripts/start-surfpool.sh
./scripts/deploy-surfpool.sh <WALLET_PUBKEY>   # fund authority key

# Terminal 2 — backend (holds SOLANA_KEYPAIR_PATH, forwards to CRE)
cd web && npx --yes tsx scripts/launch-backend.ts

# Terminal 3 — CRE HTTP trigger (keep running)
./scripts/run-cre-curve-yt-launch.sh --listen

# Terminal 4 — desk
VITE_RPC_URL=http://127.0.0.1:8899 VITE_LAUNCH_API_URL=http://127.0.0.1:8788 yarn web
```

Authority key (`~/.config/solana/id.json` by default) must be the strip **market
authority** and hold SOL + USDC on Surfpool.

## One-shot simulate (policy only)

```bash
./scripts/run-cre-curve-yt-launch.sh --once --no-executor \
  --http-payload '{"mint":"XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ","symbol":"KOx","startNonce":0,"targetNonce":2,"fairCoupon":0.02}'
```

Note: `--http-payload` must be passed to `cre` directly when using `--once`:

```bash
cd cre/orange-cre && cre workflow simulate curve-yt-launch \
  --target staging-settings --non-interactive --trigger-index 0 \
  --http-payload '{"mint":"XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ","symbol":"KOx","startNonce":0,"targetNonce":2}'
```

## Config

| Field | Staging |
|-------|---------|
| `txExecutorUrl` | `http://127.0.0.1:8788/internal/execute` |
| `chainSelector` | Solana mainnet selector (Surfpool fork) |

RPC: `cre/orange-cre/project.yaml` → `http://127.0.0.1:8899`.
