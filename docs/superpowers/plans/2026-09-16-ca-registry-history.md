# CA Registry History + Kind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `ca_registry` and the CRE xStocks sync so each mint stores full CA history with Yield/Supply kind, cumulative factors, and yield nonces — enough for late YT coupon pricing.

**Architecture:** CRE cron fetches xStocks v2 history/upcoming, maps `caType` → `kind`, and writes one `SyncEvent` per report via Keystone `on_report`. The program appends idempotently, updates `cum_y`/`cum_s`/`yield_nonce`, and exposes binary-search lookups. DivStrip is out of this plan’s code tasks (interface locked by registry layout).

**Tech Stack:** Anchor 1.1.2 / Rust, CRE Go SDK + Solana Write bindings, TypeScript Mocha tests, Surfpool local fork

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-ca-registry-divstrip-design.md`
- Branch: `feat/ca-registry-cre` (do not merge to `main` unless asked)
- Multipliers: fixed-point `1e12` (`MULTIPLIER_SCALE = 1_000_000_000_000`)
- CRE Solana report limit: ≤265 bytes → `maxEventsPerWrite = 1`
- Compute limit: ≤290000
- `MAX_EVENTS = 64`
- Kind: `0=Yield`, `1=Supply`, `2=Other`
- caType map: CashDividend/StockDividend→Yield; ForwardSplit/ReverseSplit→Supply; SpinOff→Other
- Program ID stays `2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z` unless redeploy forces change
- Do not commit unless the user explicitly asks (plan commit steps are optional checkpoints)

## File Map

| File | Responsibility |
|------|----------------|
| `programs/ca_registry/src/state.rs` | `CaEvent` layout, tip fields, binary search helpers |
| `programs/ca_registry/src/payload.rs` | `SyncEvent`/`SyncPayload` Borsh + kind |
| `programs/ca_registry/src/lib.rs` | init, insert factor math, `on_report`, lookups |
| `programs/ca_registry/src/errors.rs` | New errors for nonce / kind |
| `cre/orange-cre/xstocks-ca-sync/*.go` | kind mapping, backfill oldest-missing, schedule |
| `cre/orange-cre/contracts/solana/src/idl/ca_registry.json` | Regenerated IDL |
| `cre/orange-cre/contracts/solana/src/generated/ca_registry/` | Regenerated CRE bindings |
| `tests/helpers/xstocks-payload.ts` | Encode new SyncEvent fields |
| `tests/ca-registry.ts` | Factor + nonce + CRE integration tests |

---

### Task 1: Extend on-chain event layout and factor math

**Files:**
- Modify: `programs/ca_registry/src/state.rs`
- Modify: `programs/ca_registry/src/payload.rs`
- Modify: `programs/ca_registry/src/errors.rs`
- Modify: `programs/ca_registry/src/lib.rs`
- Test: `tests/ca-registry.ts`
- Modify: `tests/helpers/xstocks-payload.ts`

**Interfaces:**
- Consumes: existing `RegistryLog` PDA `["registry", mint]`
- Produces:
  - `CaEvent { event_id, ca_type, kind, effective_ts, multiplier_old, multiplier_new, cum_y, cum_s, yield_nonce }`
  - `RegistryLog` tip: `current_cum_y`, `current_cum_s`, `current_yield_nonce`
  - `fn event_at_yield_nonce(n: u32) -> Result<CaEvent>`
  - `SyncEvent` adds `kind: u8`

- [x] **Step 1: Write failing TS tests for Yield vs Supply factor updates**

In `tests/ca-registry.ts`, add a test that initializes a fresh mint registry and syncs two events:

```typescript
// 1) CashDividend: old=1e12, new=1.5e12 → cum_y=1.5e12, yield_nonce=1, cum_s=1e12
// 2) ForwardSplit: old=1.5e12, new=3e12 → cum_s=2e12, cum_y stays 1.5e12, yield_nonce stays 1
```

Assert via `program.account.registryLog.fetch` on `currentCumY`, `currentCumS`, `currentYieldNonce`, and last event fields.

Extend `tests/helpers/xstocks-payload.ts` `SyncEventInput` with `kind: number` and encode it after `caType` as `u8` (match Rust field order in Step 3).

- [x] **Step 2: Run test — expect fail (fields missing)**

Run:

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8899 ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 120000 tests/ca-registry.ts
```

Expected: fail compiling or on fetch of undefined account fields / wrong layout.

- [x] **Step 3: Update Rust state + payload**

`state.rs` — replace `CaEvent` / `RegistryLog` with:

```rust
pub const MULTIPLIER_SCALE: u64 = 1_000_000_000_000;
pub const KIND_YIELD: u8 = 0;
pub const KIND_SUPPLY: u8 = 1;
pub const KIND_OTHER: u8 = 2;

pub struct CaEvent {
    pub event_id: [u8; 16],
    pub ca_type: u8,
    pub kind: u8,
    pub effective_ts: i64,
    pub multiplier_old: u64,
    pub multiplier_new: u64,
    pub cum_y: u64,
    pub cum_s: u64,
    pub yield_nonce: u32,
}

pub struct RegistryLog {
    // ...existing mint/authority/forwarder/symbol/bump...
    pub current_cum_y: u64,
    pub current_cum_s: u64,
    pub current_yield_nonce: u32,
    pub event_count: u32,
    #[max_len(MAX_EVENTS)]
    pub events: Vec<CaEvent>,
}
```

Add `find_yield_nonce(&self, nonce: u32) -> Option<CaEvent>`:
- if `nonce == 0` return synthetic genesis view from tip defaults (`cum_y=SCALE`, `cum_s=SCALE`, `effective_ts=0`) when no yield events yet, or the state before first yield event
- else binary search / linear scan over events where `kind == KIND_YIELD && yield_nonce == nonce`

`payload.rs` — add `kind: u8` to `SyncEvent` (after `ca_type`).

`errors.rs` — add `InvalidKind`, `InvalidMultiplier`, `Overflow`.

- [x] **Step 4: Implement insert factor math in `lib.rs`**

On each new `SyncEvent`:

```rust
require!(multiplier_old > 0, InvalidMultiplier);
let ratio = (multiplier_new as u128)
    .checked_mul(MULTIPLIER_SCALE as u128)
    .ok_or(Overflow)?
    / (multiplier_old as u128);

let mut cum_y = registry.current_cum_y;
let mut cum_s = registry.current_cum_s;
let mut yield_nonce = registry.current_yield_nonce;

match kind {
    KIND_YIELD => {
        cum_y = (cum_y as u128).checked_mul(ratio).ok_or(Overflow)? / (MULTIPLIER_SCALE as u128);
        yield_nonce = yield_nonce.saturating_add(1);
    }
    KIND_SUPPLY => {
        cum_s = (cum_s as u128).checked_mul(ratio).ok_or(Overflow)? / (MULTIPLIER_SCALE as u128);
    }
    KIND_OTHER => {}
    _ => return err!(InvalidKind),
}

// push CaEvent { ..., cum_y, cum_s, yield_nonce }
// update tip fields
```

On `initialize_registry`: set `current_cum_y = MULTIPLIER_SCALE`, `current_cum_s = MULTIPLIER_SCALE`, `current_yield_nonce = 0`.

Add instruction:

```rust
pub fn event_at_yield_nonce(ctx: Context<LookupAt>, nonce: u32) -> Result<CaEvent>
```

Keep `lookup_at(ts)` binary search on `effective_ts`.

- [x] **Step 5: Rebuild, redeploy to local/Surfpool RPC, pass tests**

```bash
anchor build -p ca_registry
anchor deploy -p ca_registry --provider.cluster localnet
ARANCIO_RPC_URL=http://127.0.0.1:8899 ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 120000 tests/ca-registry.ts
```

Expected: new factor test PASS; fix existing tests for new account layout / encode order.

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add programs/ca_registry tests/ca-registry.ts tests/helpers/xstocks-payload.ts
git commit -m "feat(ca_registry): store kind, cumulative factors, and yield nonces"
```

---

### Task 2: CRE maps caType → kind and backfills oldest missing event

**Files:**
- Modify: `cre/orange-cre/xstocks-ca-sync/xstocks.go`
- Modify: `cre/orange-cre/xstocks-ca-sync/payload.go`
- Modify: `cre/orange-cre/xstocks-ca-sync/workflow.go`
- Modify: `cre/orange-cre/xstocks-ca-sync/config.staging.json`
- Modify: `cre/orange-cre/xstocks-ca-sync/config.production.json`
- Copy/regenerate: `cre/orange-cre/contracts/solana/src/idl/ca_registry.json`
- Regenerate: `cre/orange-cre/contracts/solana/src/generated/ca_registry/`

**Interfaces:**
- Consumes: Task 1 `SyncEvent.kind`, `WriteReportFromSyncPayload`
- Produces: CRE writes events with correct `kind`; prefers oldest incomplete history event per run

- [x] **Step 1: Add failing Go unit test for kind mapping + oldest-missing selection**

In `cre/orange-cre/xstocks-ca-sync/xstocks_test.go` (new):

```go
func TestCaTypeToKind(t *testing.T) {
    if kind, ok := caTypeToKind("CashDividend"); !ok || kind != 0 { t.Fatal() }
    if kind, ok := caTypeToKind("ForwardSplit"); !ok || kind != 1 { t.Fatal() }
    if kind, ok := caTypeToKind("SpinOff"); !ok || kind != 2 { t.Fatal() }
}

func TestSelectOldestWritable(t *testing.T) {
    // given two history nodes sorted by time, knownIDs contains the older hash
    // expect selectOldestWritable returns the newer-only when older known;
    // when none known, returns oldest with both multipliers non-nil
}
```

- [x] **Step 2: Run Go test — expect fail**

```bash
cd cre/orange-cre && go test ./xstocks-ca-sync/ -count=1
```

Expected: FAIL undefined `caTypeToKind` / `selectOldestWritable`.

- [x] **Step 3: Implement mapping + selection + payload kind**

```go
func caTypeToKind(caType string) (uint8, bool) {
    switch caType {
    case "CashDividend", "StockDividend":
        return 0, true
    case "ForwardSplit", "ReverseSplit":
        return 1, true
    case "SpinOff":
        return 2, true
    default:
        return 0, false
    }
}
```

Update `SyncEvent` in `payload.go` to include `Kind uint8` after `CaType` (borsh order must match Rust).

In `apiNodeToSyncEvent`, set `Kind` from `caTypeToKind`; skip nodes with missing multipliers (nil old/new).

`selectOldestWritable(nodes, knownEventIDs map[[16]byte]struct{})`:
1. Sort by `effectiveTimeUtc` ascending
2. Return first node whose hashed id ∉ known and multipliers present

Workflow change for write path:
- Still fetch history+upcoming
- Build full list, then **write only `selectOldestWritable`** (one event) when `writeOnchain`
- Config `schedule`: `"0 0 */6 * * *"`
- Keep `maxEventsPerWrite: 1`

Note: CRE WASM cannot easily read Solana registry tip yet for `knownEventIDs`. For v1 simulate/hackathon: pass empty known set and rely on on-chain dedup by `event_id` (program skips duplicates). Document that repeated cron re-writes the same oldest until a *new* event exists — **fix**: prefer iterating candidates and writing the first that would insert; without read, CRE may keep submitting the same oldest and program returns `inserted=0`. Acceptable for demo if operator uses authority `sync_events` for bulk backfill OR CRE loops all history via multiple simulate invocations while program dedups (wasteful but correct).

**Preferred v1 approach (implement this):** CRE still sends the **oldest history event not yet attempted in this run’s cursor**. For a single simulate invocation, walk sorted history and `WriteReport` the first event; for full backfill in tests, call simulate N times OR use `sync_events` bulk in TS tests. Add config `backfillMode: "oldest"` (default).

Better hackathon approach for Task 2: keep writing **newest** for live tip OR add TS test helper that bulk `sync_events` full history; CRE path writes one event for E2E proof. Spec asked for full history in registry — satisfy via **authority bulk sync from API fixture in tests** + CRE proves write path.

Implement both:
1. CRE: write oldest event from history that has multipliers (program dedups)
2. Test helper `backfillFromApiFixture()` using `sync_events` with all history events for KOx

- [x] **Step 4: Regenerate Solana bindings**

```bash
cp target/idl/ca_registry.json cre/orange-cre/contracts/solana/src/idl/ca_registry.json
cd cre/orange-cre && cre generate-bindings solana --language go
cd cre/orange-cre && go test ./xstocks-ca-sync/ -count=1
GOOS=wasip1 GOARCH=wasm go build -o /dev/null ./xstocks-ca-sync
```

Expected: tests PASS; WASM builds; `WriteReportFromSyncPayload` still exists.

- [x] **Step 5: Dry-run CRE simulate**

```bash
cd cre/orange-cre
cre workflow simulate xstocks-ca-sync --target staging-settings --non-interactive --trigger-index 0
```

Expected: `TX_STATUS_SUCCESS`, `PayloadBase64` present, logs show `kind` path without ResourceExhausted.

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add cre/orange-cre
git commit -m "feat(cre): map caType to kind and sync single CA events"
```

---

### Task 3: Full KOx history on Surfpool + lookup APIs

**Files:**
- Modify: `tests/ca-registry.ts`
- Modify: `tests/helpers/xstocks-payload.ts`
- Optional script: `scripts/backfill-kox-registry.ts`

**Interfaces:**
- Consumes: Task 1 lookups; Task 2 encoding
- Produces: Surfpool registry with full KOx history; coupon-ready nonce reads

- [x] **Step 1: Write failing test `backfills KOx history and resolves yield nonces`**

```typescript
// Fetch https://api.xstocks.fi/api/v2/public/corporate-actions/history?symbol=KOx&network=Solana
// Filter nodes with multiplierOld && multiplierNew
// encodeSyncPayload all events with kinds
// sync_events once (or chunk if needed)
// expect eventCount == filtered.length
// expect currentYieldNonce == count(kind==Yield)
// event_at_yield_nonce(1) returns first dividend cum_y
// lookup_at(mid_ts) returns expected event
```

- [x] **Step 2: Run — expect fail until helper + ix wired**

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8899 ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 180000 tests/ca-registry.ts
```

- [x] **Step 3: Implement API fetch helper + call `eventAtYieldNonce`**

Helper in `tests/helpers/xstocks-payload.ts`:

```typescript
export async function fetchKoxHistory(): Promise<SyncEventInput[]> { /* fetch + map */ }
export function caTypeToKind(caType: string): number { /* same map as Go */ }
```

Ensure Anchor client method name matches IDL (`eventAtYieldNonce`).

- [x] **Step 4: Optional CRE `--broadcast` smoke**

With Surfpool up, registry initialized with mock forwarder state `jhCjuD4Z3V7HeSUChMRpkRwpw6B9yC63mxDMv8SdLNX`:

```bash
cd cre/orange-cre
cre workflow simulate xstocks-ca-sync --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

Expected: real `TxSignature`; registry `eventCount >= 1`.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add tests/ca-registry.ts tests/helpers/xstocks-payload.ts scripts/
git commit -m "test(ca_registry): backfill KOx history and verify nonce lookups"
```

---

### Task 4: Spec self-check + docs touch-up

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-ca-registry-divstrip-design.md` (mark success criteria done)
- Create: short note in `cre/orange-cre/xstocks-ca-sync/README.md` on simulate/backfill

- [x] **Step 1: Update README with exact commands**

Document:
- Surfpool start
- `anchor deploy -p ca_registry`
- initialize registry
- bulk backfill test
- `cre workflow simulate ...` and `--broadcast`

- [x] **Step 2: Tick success criteria in spec** that this plan covered

- [x] **Step 3: Stop — DivStrip wrap/unwrap is a follow-up plan**

Do not implement DivStrip in this plan.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| kind + cum_y/cum_s/yield_nonce per event | Task 1 |
| Factor rules Yield/Supply/Other | Task 1 |
| `lookup_at` + `event_at_yield_nonce` | Task 1 |
| CRE history+upcoming, cron ~6h, 1 event/write | Task 2 |
| Full history for tracked stock (KOx) | Task 3 |
| Surfpool / simulate write path | Task 2–3 |
| DivStrip wrap | **Deferred** (follow-up plan) |

## Placeholder scan

None intentional. Commit steps gated on user request.
