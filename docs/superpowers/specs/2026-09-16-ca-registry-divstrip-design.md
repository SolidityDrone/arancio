# Design: CA Registry + DivStrip (xStocks PT/YT on Solana)

Date: 2026-09-16  
Branch: `feat/ca-registry-cre`  
Status: Approved; registry history + kind implemented on `feat/ca-registry-cre`

## Goal

Build an on-chain corporate-action registry fed by Chainlink CRE from xStocks v2 APIs, with enough history and kind classification for a standalone Capital/Yield splitter (DivStrip) modeled on ERC-8056 — without issuing the underlying xStock (Backed does that).

Late YT redemption must pay the **frozen coupon** for the window `(startNonce, targetNonce)`, never the live multiplier.

## Non-goals (this phase)

- Issuing or rebasing xStock mints
- Full DivStrip wrapper UI / frontend
- Deployed CRE DON production (simulate + Surfpool broadcast is enough for hackathon)
- Spin-off economics (v1: record as `Other` / optional series terminate later)

## Architecture

```
xStocks v2 API (history + upcoming)
        │
        ▼
CRE cron (~6h; manual trigger in tests)
  HTTP fetch + DON consensus
  WriteReportFromSyncPayload (1 event / report, ≤265B)
        │
        ▼
Keystone Forwarder (mock in simulate)
        │
        ▼
ca_registry.on_report  ──► RegistryLog PDA ["registry", mint]
        │
        ▼
divstrip (later) reads history via:
  current_yield_nonce()
  event_at_yield_nonce(n) → cum_Y
  coupon(start, target) = max(1 - Y_s/Y_t, 0)
```

Two programs:

| Program | Role |
|---------|------|
| `ca_registry` | Infra: append-only CA history per mint, kind, cumulative factors, nonce lookups |
| `divstrip` | Consumer: wrap raw xStock → `xCapital-{sym}` + `xYield-{sym}` for a window; unwrap with frozen coupon |

This phase upgrades **`ca_registry` + CRE sync** so history is correct for every tracked stock. DivStrip scaffolding can follow in the same branch once registry APIs are stable.

## Kind mapping (xStocks `caType` → class)

| `caType` | Class / kind | Effect on factors |
|----------|--------------|-------------------|
| `CashDividend` | Yield | Advances `yield_nonce`; updates `cum_Y` |
| `StockDividend` | Yield | Same |
| `ForwardSplit` | Supply | Updates `cum_S` only; **no** yield nonce tick |
| `ReverseSplit` | Supply | Same |
| `SpinOff` | Other | Recorded; does not tick yield nonce; DivStrip may refuse new wraps |

On-chain `kind` enum: `0=Yield, 1=Supply, 2=Other` (independent of raw `ca_type` string code for API fidelity — store both `ca_type` and derived `kind`).

## Account model (`RegistryLog`)

PDA seeds: `["registry", mint]`.

Per event (`CaEvent`), sorted ascending by `effective_ts`:

| Field | Meaning |
|-------|---------|
| `event_id[16]` | Hash of xStocks `eventId` (dedup) |
| `ca_type` | Original API type code |
| `kind` | Yield / Supply / Other |
| `effective_ts` | Activation unix time |
| `multiplier_old` / `multiplier_new` | Composite scaled UI multipliers (1e12 fixed) at the CA boundary |
| `cum_y` | Cumulative **Yield** factor after this event (1e12; unchanged if kind≠Yield) |
| `cum_s` | Cumulative **Supply** factor after this event (1e12; unchanged if kind≠Supply) |
| `yield_nonce` | Yield-event count **after** this event (0 = genesis; only increments on Yield) |

Registry header also stores:

- `mint`, `authority`, `forwarder_state`, `symbol`
- `event_count`
- `current_cum_y`, `current_cum_s`, `current_yield_nonce` (denormalized tip for cheap reads)

Genesis: at `initialize_registry`, push or imply checkpoint `yield_nonce=0`, `cum_y=1e12`, `cum_s=1e12`, `effective_ts=0` (no API event).

### Factor update rule

xStocks publishes a single composite multiplier `m`. We cannot recover class ratios from `m` alone without `caType`. Given `kind` from API:

- **Yield:** `ratio = multiplier_new / multiplier_old`; `cum_y' = cum_y * ratio`; `yield_nonce' = yield_nonce + 1`; `cum_s` unchanged.
- **Supply:** `ratio = multiplier_new / multiplier_old`; `cum_s' = cum_s * ratio`; `cum_y` / nonce unchanged.
- **Other:** store event; factors and yield nonce unchanged.

Always require `multiplier_new` and `multiplier_old` when present in history; upcoming rows may omit multipliers until scheduling — CRE only writes events that have both multipliers (history) or skips incomplete upcoming until multipliers appear on-chain / in history.

## Program instructions

| Ix | Who | Behavior |
|----|-----|----------|
| `initialize_registry(symbol, forwarder_state)` | authority | Create PDA + genesis tip |
| `sync_events(bytes)` | authority | Test/Surfpool path; same payload as CRE |
| `on_report(metadata, report)` | forwarder CPI | Decode `SyncPayload`, insert, recompute factors |
| `lookup_at(ts)` | anyone | Binary search last event with `effective_ts <= ts` |
| `event_at_yield_nonce(n)` | anyone | Binary / indexed lookup of Yield event with `yield_nonce == n` (n=0 → genesis tip) |
| `current_yield_nonce()` | anyone | Return tip nonce (view via account read preferred) |

Binary search mirrors ERC-8056 `findLastEffectiveAt` / `classEventAtNonce`: upper-bound on sorted keys, return last matching.

Capacity: `MAX_EVENTS = 64` for v1 (fits account realloc limits). Sharding is out of scope.

## SyncPayload (CRE)

Borsh payload for one write (≤265B report limit → **one event per WriteReport**):

```
SyncPayload { mint, events: [SyncEvent; 1] }
SyncEvent {
  event_id[16],
  ca_type,
  kind,              // NEW — CRE derives from caType
  effective_ts,
  multiplier_old,
  multiplier_new,
}
```

On insert, program computes `cum_y` / `cum_s` / `yield_nonce` from previous tip + `kind` + ratio. Client does **not** send cumulatives (avoids DON disagreement); program is source of truth.

### CRE workflow

- Trigger: cron `0 0 */6 * * *` (every 6 hours); tests force simulate once.
- Fetch:
  - `GET .../corporate-actions/history?symbol=&network=Solana&page=&pageSize=`
  - `GET .../corporate-actions/upcoming?symbol=&network=Solana&...`
- Merge, dedup by `eventId`, sort by `effectiveTimeUtc`.
- For each mint in config list: write oldest missing event first (backfill), one `WriteReport` per simulate run (or loop in deployed DON).
- Config: `symbols[]`, `mints[]`, `schedule`, forwarder IDs, `maxEventsPerWrite: 1`.

## DivStrip (next slice; interface locked by this registry)

Standalone wrapper (not in-mint):

- `wrap(raw, lock_nonces) → (start, target)` where `start = current_yield_nonce()`, `target = start + lock_nonces`
- Mint `xCapital-{SYMBOL}` + `xYield-{SYMBOL}` (or per-window mint PDAs with suffix `start-target`) 1:1 with raw escrowed
- `unwrap` both anytime at par
- `unwrap_yield` / `unwrap_capital` only if `current_yield_nonce() >= target`
- Coupon: `1 - cum_y(start) / cum_y(target)` from registry

## Testing

1. Unit: factor updates Yield vs Supply; binary search `lookup_at` / `event_at_yield_nonce`
2. CRE dry-run: payload includes `kind`
3. Surfpool `--broadcast`: history backfill for KOx; `event_count` matches API history with multipliers
4. Coupon fixture: Alice window (0,2) vs Bob (1,2) using synthetic Yield events — equal to ERC-8056 worked example

## Error handling

- Duplicate `event_id` → skip (idempotent)
- Mint mismatch → hard fail
- Missing multipliers on write → CRE skips event
- Capacity exceeded → fail write (operator must raise limit / rotate)
- Invalid forwarder authority → fail `on_report`

## Success criteria (this phase)

- [x] KOx (and config list) registries hold **full** yield/supply history from API, not a single tip event
- [x] Each event has correct `kind` and updated `cum_y` / `cum_s` / `yield_nonce`
- [x] `lookup_at` and `event_at_yield_nonce` work for late pricing
- [x] CRE simulate (+ optional `--broadcast` on Surfpool) inserts history without authority `sync_events` for the happy path
- [x] Spec enables DivStrip without changing registry layout again

> DivStrip wrap/unwrap remains a follow-up plan (out of scope for this phase).

## DivStrip status (shipped)

- [x] `divstrip` program: initialize / create_series / wrap / unwrap / redeem_capital / redeem_yield
- [x] Coupon `1 − cum_y(start)/cum_y(target)` after maturity
- [x] Local Stocklana-styled web desk (`web/`) with Phantom / Solflare / Torus
