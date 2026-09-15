# Arancio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fork-first Solana Anchor workspace that creates immutable named custom basket vaults and executes real Jupiter and Kamino deposit/redemption flows against Surfpool mainnet state.

**Architecture:** One Anchor program owns the global config, frozen address book, immutable vault configs, share mints, component custody accounts, and Kamino obligations. A TypeScript client discovers live Kamino reserves, loads the address book, builds Jupiter `/build` routes, composes transactions, and always targets the local Surfpool RPC for execution.

**Tech Stack:** Anchor `1.1.2`, Agave/Solana CLI `3.1.10`, Rust, TypeScript, Mocha, Surfpool `1.5.0`, SPL Token and Token-2022, Kamino `klend-interface`, Jupiter Swap API V2 `/build` and CPI.

## Global Constraints

- All chain-dependent tests use a mainnet-backed Surfpool endpoint; no devnet or mocked protocol path is accepted.
- Vault names, input mints, component mints, component order, weights, and protocol references are immutable after vault creation.
- Component weights sum to exactly `10_000` basis points; deposit amounts are arbitrary.
- No asset symbols, token mints, external protocol IDs, or network-specific addresses are hardcoded in vault logic.
- Protocol addresses are loaded from a frozen on-chain `AddressBook` through a client `addresses` helper.
- xStocks use raw Token-2022 amounts for transfers; the active `ScaledUiAmount` multiplier is used only for value/display conversion.
- Kamino lending uses reserve collateral receipts and a vault-owned obligation; Arancio shares are separate.
- Jupiter CPI routes must fit Solana account and compute limits; CPI cannot use Address Lookup Tables.
- Every production behavior is implemented test-first: write a failing test, verify the expected failure, implement the smallest change, and rerun the focused and full suites.

---

## File Map

- Create: `Anchor.toml` for workspace, provider, toolchain, and Surfpool test settings.
- Create: `Cargo.toml` and `programs/arancio/Cargo.toml` for the Anchor workspace and on-chain dependencies.
- Create: `programs/arancio/src/lib.rs` for instruction exports only.
- Create: `programs/arancio/src/state.rs` for `GlobalConfig`, `AddressBook`, `VaultConfig`, and component records.
- Create: `programs/arancio/src/errors.rs` for stable validation and accounting errors.
- Create: `programs/arancio/src/math.rs` for weight, share, and proportional-claim arithmetic.
- Create: `programs/arancio/src/instructions/config.rs` for global configuration and address-book initialization/freeze.
- Create: `programs/arancio/src/instructions/vault.rs` for immutable named vault creation.
- Create: `programs/arancio/src/instructions/deposit.rs` for Jupiter-to-Kamino deposit flow.
- Create: `programs/arancio/src/instructions/redeem.rs` for in-kind and single-output redemption.
- Create: `programs/arancio/src/integrations/kamino.rs` for reserve, collateral, obligation, and CPI account validation.
- Create: `programs/arancio/src/integrations/jupiter.rs` for route account validation and Jupiter CPI construction.
- Create: `tests/arancio.ts` for Surfpool integration tests.
- Create: `tests/math.ts` for client-side preview parity tests.
- Create: `ts/client/addresses.ts` for runtime address-book loading and typed network configuration.
- Create: `ts/client/discovery.ts` for live Kamino reserve discovery and supply eligibility.
- Create: `ts/client/routes.ts` for Jupiter `/build` responses and bounded CPI route preparation.
- Create: `ts/client/vault.ts` for vault create, deposit, and redemption transaction builders.
- Create: `scripts/start-surfpool.sh` for the documented mainnet-backed local endpoint.
- Create: `scripts/check-toolchain.sh` for deterministic tool version checks.
- Modify: `README.md` with setup, test, and Surfpool commands.

## Task 1: Bootstrap The Anchor Workspace

**Files:**
- Create: generated Anchor workspace files at the repository root.
- Modify: `README.md`.

**Interfaces:**
- Produces an Anchor v1 workspace with `anchor build`, `anchor test`, and
  `anchor keys list` working before protocol code is added.

- [ ] **Step 1: Generate the workspace skeleton without installing unrelated agent skills**

Run from the repository root:

```bash
anchor init arancio --no-git --no-install --template multiple --test-template mocha --anchor-version v1
```

Move the generated workspace files into the repository root, preserve the
existing `README.md` and `docs/`, and remove only the temporary `arancio/`
directory after confirming its contents are copied.

- [ ] **Step 2: Pin the toolchain and package manager**

Set the workspace configuration to Anchor `1.1.2`, Solana `3.1.10`, Yarn, and
the local Surfpool provider. Keep `anchor build` and `anchor test` independent
of a public cluster.

- [ ] **Step 3: Write the failing workspace smoke test**

Add a test named `workspace smoke test can read the provider cluster` that
connects to the provider URL and asserts the RPC health/slot call returns a
number.

- [ ] **Step 4: Run the smoke test before the implementation exists**

Run:

```bash
./scripts/start-surfpool.sh
yarn mocha tests/arancio.ts --grep "workspace smoke"
```

Expected: the test fails only because `scripts/start-surfpool.sh` or the test
helper has not been added yet, not because of a TypeScript syntax error.

- [ ] **Step 5: Add the minimal scripts and test helper**

`start-surfpool.sh` must run:

```bash
surfpool start --network mainnet --db ./.surfpool/arancio.sqlite --no-tui
```

The helper must read `ARANCIO_RPC_URL`, defaulting to
`http://127.0.0.1:8899`, and construct a Solana `Connection` from that value.

- [ ] **Step 6: Run the focused test and build**

Run:

```bash
yarn mocha tests/arancio.ts --grep "workspace smoke"
anchor build
```

Expected: the smoke test passes and the generated program builds.

- [ ] **Step 7: Commit**

```bash
git add Anchor.toml Cargo.toml Cargo.lock package.json yarn.lock programs tests scripts README.md
git commit -m "build: bootstrap Arancio Anchor workspace"
```

## Task 2: Add Arithmetic And Immutable Configuration

**Files:**
- Create: `programs/arancio/src/math.rs`.
- Create: `programs/arancio/src/state.rs`.
- Create: `programs/arancio/src/errors.rs`.
- Create: `programs/arancio/src/instructions/config.rs`.
- Create: `programs/arancio/src/instructions/vault.rs`.
- Modify: `programs/arancio/src/lib.rs`.
- Test: Rust unit tests in `programs/arancio/src/math.rs` and Surfpool tests in `tests/arancio.ts`.

**Interfaces:**
- `validate_weights(weights: &[u16]) -> Result<()>` requires a non-empty list
  whose checked sum is `10_000`.
- `shares_for_deposit(assets: u128, supply: u128, total_assets: u128) -> Result<u128>`
  uses first-deposit one-to-one base-unit accounting and floor division for
  later deposits.
- `proportional_amount(amount: u128, shares: u128, supply: u128) -> Result<u128>`
  uses checked floor division.
- `initialize_global_config(address_book: Pubkey, max_components: u8)` creates
  the PDA-derived global config.
- `initialize_address_book(program_ids: AddressBookInput)` creates the address
  book; `freeze_address_book()` permanently disables edits.
- `create_vault(name: Vec<u8>, input_mint: Pubkey, components: Vec<ComponentInput>)`
  creates immutable vault state and its share mint.

The on-chain input records are:

```rust
pub struct AddressBookInput {
    pub kamino_program: Pubkey,
    pub jupiter_program: Pubkey,
    pub token_program: Pubkey,
    pub token_2022_program: Pubkey,
    pub associated_token_program: Pubkey,
}

pub struct ComponentInput {
    pub mint: Pubkey,
    pub reserve: Pubkey,
    pub collateral_mint: Pubkey,
    pub oracle: Pubkey,
    pub weight_bps: u16,
}
```

- [ ] **Step 1: Write failing arithmetic tests**

Cover these exact cases:

```rust
#[test]
fn rejects_empty_or_non_total_weights() {}

#[test]
fn floors_later_deposit_shares() {}

#[test]
fn rejects_zero_total_assets_and_overflow() {}

#[test]
fn floors_proportional_redemption() {}
```

- [ ] **Step 2: Run the arithmetic tests and confirm the intended failures**

Run:

```bash
cargo test -p arancio math::tests
```

Expected: failures report missing arithmetic functions or missing validation.

- [ ] **Step 3: Implement checked arithmetic only**

Use `u128::checked_add`, `checked_mul`, and `checked_div`; convert to the
stored integer width only after checking the result fits. Return explicit
program errors for empty weights, invalid weight totals, division by zero, and
overflow.

- [ ] **Step 4: Run the arithmetic tests green**

Run:

```bash
cargo test -p arancio math::tests
```

- [ ] **Step 5: Write failing Surfpool tests for immutable configuration**

Test that a named vault stores the exact name, arbitrary component mints,
custom weights, and input mint; a second update attempt fails; and an address
book cannot be used before it is frozen.

- [ ] **Step 6: Implement state accounts and instructions**

Store variable-length data with explicit maximum byte lengths and reject data
that exceeds the configured allocation. Derive `GlobalConfig`, `AddressBook`,
and `VaultConfig` from program PDAs. Store the address-book key in global
config and require the frozen flag in `create_vault`. Do not embed any external
program or asset address in Rust source.

- [ ] **Step 7: Run focused integration tests and build**

Run:

```bash
yarn mocha tests/arancio.ts --grep "configuration|named vault|immutable"
anchor build
```

- [ ] **Step 8: Commit**

```bash
git add programs/arancio tests/arancio.ts
git commit -m "feat: add immutable named vault configuration"
```

## Task 3: Add Runtime Address And Kamino Reserve Discovery

**Files:**
- Create: `ts/client/addresses.ts`.
- Create: `ts/client/discovery.ts`.
- Create: `tests/discovery.ts`.
- Modify: `README.md` with live discovery commands.

**Interfaces:**
- `loadAddressBook(connection, programId, addressBook): Promise<AddressBook>`
  reads the frozen on-chain account and returns typed protocol IDs.
- `discoverSupplyReserves(connection, market): Promise<ReserveDescriptor[]>`
  fetches the configured Kamino market and filters only reserves whose live
  configuration allows new supply.
- `assertReserveMatchesComponent(reserve, mint): void` rejects a mismatched
  liquidity mint, collateral mint, market, or token program.

The client records are:

```ts
export type AddressBook = {
  kaminoProgram: PublicKey;
  jupiterProgram: PublicKey;
  tokenProgram: PublicKey;
  token2022Program: PublicKey;
  associatedTokenProgram: PublicKey;
  frozen: boolean;
};

export type ReserveDescriptor = {
  market: PublicKey;
  reserve: PublicKey;
  liquidityMint: PublicKey;
  collateralMint: PublicKey;
  oracle: PublicKey;
  supplyEnabled: boolean;
};
```

- [ ] **Step 1: Write failing live discovery tests**

Against Surfpool mainnet state, assert that discovery returns at least one
reserve, every returned reserve has a non-empty liquidity mint and collateral
mint, and a deliberately mismatched mint is rejected.

- [ ] **Step 2: Run tests and confirm failure before discovery code exists**

Run:

```bash
yarn mocha tests/discovery.ts
```

- [ ] **Step 3: Implement address-book loading**

Use the program account bytes/IDL to decode the frozen address book. The helper
must not contain token or protocol literals; it receives the program ID and
address-book PDA from deployment configuration.

- [ ] **Step 4: Implement reserve discovery**

Use Kamino's market API only to find candidate accounts. Fetch the corresponding
on-chain reserve accounts through Surfpool and perform final supply/mint/market
validation from account state. Do not use symbols as identity.

- [ ] **Step 5: Run focused tests green**

Run:

```bash
yarn mocha tests/discovery.ts
```

- [ ] **Step 6: Commit**

```bash
git add ts/client tests/discovery.ts README.md
git commit -m "feat: discover live Kamino supply reserves"
```

## Task 4: Implement Share Mint And Kamino Deposit Adapter

**Files:**
- Create: `programs/arancio/src/integrations/kamino.rs`.
- Create: `programs/arancio/src/instructions/deposit.rs`.
- Create: `tests/kamino-deposit.ts`.
- Modify: `programs/arancio/src/lib.rs` and `programs/arancio/src/state.rs`.

**Interfaces:**
- `validate_kamino_accounts(ctx) -> Result<()>` checks market, reserve,
  liquidity mint, collateral mint, token program, and supply status.
- `deposit_component(ctx, amount: u64) -> Result<u64>` CPI-calls Kamino's
  reserve-liquidity deposit and returns the observed collateral-receipt delta.
- `deposit_vault(input_amount: u64, min_shares: u64, routes: Vec<RouteSpec>)`
  receives component output deltas, supplies them to Kamino, and mints shares.

`RouteSpec` contains `input_mint`, `output_mint`, `minimum_output`, and the
ordered remaining-account slice used by the Jupiter CPI. The route account
slice is supplied as instruction accounts, not serialized as an unchecked
address list.

- [ ] **Step 1: Write the failing Kamino account-validation test**

Use a live reserve account from discovery. Assert that a component deposit with
the correct reserve creates/updates the vault obligation and collateral receipt
account. Assert a reserve from another market fails.

- [ ] **Step 2: Run the focused test and record the protocol failure**

Run:

```bash
yarn mocha tests/kamino-deposit.ts --grep "reserve validation"
```

- [ ] **Step 3: Add the exact Kamino CPI dependency and account adapter**

Use the Kamino `klend-interface` crate/version compatible with the selected
program deployment. Construct the same deposit account set documented by
Kamino's `deposit_and_collateral_v2` helper, including refresh instructions,
vault-owned destination collateral account, and the vault obligation.

- [ ] **Step 4: Write failing share-mint and deposit tests**

Assert that a successful component deposit mints shares only after every
component has been supplied, that `min_shares` is enforced, and that a failed
Kamino CPI leaves the input and share supply unchanged.

- [ ] **Step 5: Implement the atomic deposit instruction**

Transfer input custody, consume verified component output deltas, execute each
Kamino supply CPI, calculate shares from actual value added, and mint through
the vault PDA signer. Reject zero amounts, disabled reserves, mismatched
accounts, and insufficient minimum shares.

- [ ] **Step 6: Run the focused fork tests**

Run:

```bash
yarn mocha tests/kamino-deposit.ts
```

Expected: all tests execute against Surfpool and use real Kamino accounts.

- [ ] **Step 7: Commit**

```bash
git add programs/arancio tests/kamino-deposit.ts
git commit -m "feat: supply vault components to Kamino"
```

## Task 5: Implement Jupiter Route Preparation And Atomic Deposit Swaps

**Files:**
- Create: `ts/client/routes.ts`.
- Create: `programs/arancio/src/integrations/jupiter.rs`.
- Modify: `programs/arancio/src/instructions/deposit.rs`.
- Create: `tests/jupiter-routes.ts`.

**Interfaces:**
- `buildRoute(inputMint, outputMint, amount, taker): Promise<BuiltRoute>` calls
  Swap API V2 `/build` and returns raw instructions without trusting its
  remote blockhash.
- `prepareCpiRoute(route, maxAccounts): PreparedCpiRoute` rejects ALTs and
  account counts over the configured CPI limit.
- `validate_swap_delta(before, after, min_out) -> Result<()>` checks raw token
  balance deltas.

The client route records are:

```ts
export type BuiltRoute = {
  inputMint: PublicKey;
  outputMint: PublicKey;
  inputAmount: bigint;
  quotedOutput: bigint;
  minimumOutput: bigint;
  setupInstructions: TransactionInstruction[];
  swapInstruction: TransactionInstruction;
  cleanupInstruction?: TransactionInstruction;
  lookupTables: AddressLookupTableAccount[];
};

export type PreparedCpiRoute = BuiltRoute & {
  cpiAccounts: AccountMeta[];
};
```

- [ ] **Step 1: Write failing route tests**

Test that `/build` output is rebuilt with a local Surfpool blockhash, that a
  route containing lookup-table-only accounts is rejected for CPI, and that a
  post-swap raw output below `min_out` fails.

- [ ] **Step 2: Run the route tests and confirm expected failures**

Run:

```bash
yarn mocha tests/jupiter-routes.ts
```

- [ ] **Step 3: Implement `/build` client integration**

Require `JUPITER_API_KEY` from the environment, pass `maxAccounts`, and use
  the returned setup/swap/cleanup instructions as data for the vault
  transaction. Replace the API blockhash with a blockhash fetched from
  Surfpool before signing.

- [ ] **Step 4: Implement on-chain route checks and CPI**

Validate the Jupiter program ID from the frozen address book, every destination
token account owner/mint, and the route's expected input/output mints. Record
pre-swap balances and verify post-swap raw deltas. Do not trust quoted output
alone.

- [ ] **Step 5: Compose swap, Kamino supply, and share mint atomically**

For every component, swap into the vault-owned Token-2022 account, check its
minimum raw output, supply it to Kamino, then include its actual value in share
calculation. The entire instruction must fail if any route or CPI fails.

- [ ] **Step 6: Run fork integration tests**

Run:

```bash
yarn mocha tests/jupiter-routes.ts tests/kamino-deposit.ts
```

- [ ] **Step 7: Commit**

```bash
git add ts/client programs/arancio tests
git commit -m "feat: add Jupiter CPI deposit routing"
```

## Task 6: Implement Multiplier-Aware NAV And Redemption

**Files:**
- Create: `programs/arancio/src/instructions/redeem.rs`.
- Modify: `programs/arancio/src/math.rs` and `programs/arancio/src/integrations/kamino.rs`.
- Create: `tests/redemption.ts`.
- Modify: `ts/client/vault.ts`.

**Interfaces:**
- `active_multiplier(mint_account, clock_timestamp) -> Result<FixedPoint>` selects
  `multiplier` or `new_multiplier` according to the effective timestamp.
- `withdraw_component(ctx, shares) -> Result<u64>` withdraws the proportional
  underlying amount from Kamino and returns raw component units.
- `redeem_in_kind(shares, receiver) -> Result<Vec<u64>>` burns shares and
  transfers raw component amounts.
- `redeem_to_output(shares, output_mint, routes, min_out) -> Result<u64>` burns
  shares, withdraws components, swaps each component, and transfers the output.

`FixedPoint` is a `u128` scaled integer with a module-level scale constant;
all conversions check multiplication and division before narrowing to token
amount widths.

- [ ] **Step 1: Write failing redemption and multiplier tests**

Cover proportional floor rounding, zero supply rejection, raw xStock transfer
amounts, scheduled multiplier activation, in-kind output, output-mint
slippage, and rollback when one component route fails.

- [ ] **Step 2: Run tests and verify the red state**

Run:

```bash
yarn mocha tests/redemption.ts
```

- [ ] **Step 3: Implement multiplier and NAV helpers**

Decode Token-2022 `ScaledUiAmountConfig`, select the active multiplier using the
clock account, convert raw component claims to the configured accounting unit,
and use the verified Kamino oracle path exactly once.

- [ ] **Step 4: Implement in-kind redemption**

Burn shares before releasing assets, withdraw each proportional Kamino
position, and transfer raw component units to the receiver. Use checked
proportional math and return any permitted rounding remainder to the vault.

- [ ] **Step 5: Implement single-output redemption**

Withdraw the same component claims, execute validated Jupiter routes, enforce
per-route and aggregate minimums, and transfer only the selected output mint.

- [ ] **Step 6: Run the redemption suite and full build**

Run:

```bash
yarn mocha tests/redemption.ts
anchor build
```

- [ ] **Step 7: Commit**

```bash
git add programs/arancio ts/client tests
git commit -m "feat: add multiplier-aware vault redemption"
```

## Task 7: Complete Client, Documentation, And End-to-End Acceptance Tests

**Files:**
- Create: `ts/client/vault.ts` transaction builders.
- Create: `tests/e2e.ts`.
- Create: `scripts/check-toolchain.sh`.
- Modify: `README.md`.

**Interfaces:**
- `createNamedVault(config): Promise<PublicKey>` builds the immutable vault
  creation transaction from discovered accounts.
- `depositIntoVault(vault, amount, receiver): Promise<Signature>` builds and
  simulates the complete swap/supply/mint transaction.
- `redeemFromVault(vault, shares, mode): Promise<Signature>` builds and
  simulates either in-kind or single-output redemption.

- [ ] **Step 1: Write the end-to-end acceptance test**

The test must create a named custom-weight vault from live discoverable reserve
accounts, deposit two arbitrary input amounts, verify shares and Kamino
collateral receipts, redeem in kind, redeem to a selected output mint, and
assert no hardcoded asset symbol is required by the client.

- [ ] **Step 2: Run the acceptance test and capture all missing integration gaps**

Run:

```bash
yarn mocha tests/e2e.ts
```

Fix protocol account or serialization errors in the integration modules, not
by weakening assertions or replacing live accounts with mocks.

- [ ] **Step 3: Add toolchain and fork commands to the README**

Document the verified versions, environment variables, the Surfpool command,
Jupiter API-key requirement, test commands, and the distinction between
Surfpool and `solana-test-validator --clone`.

- [ ] **Step 4: Add the final verification script**

`check-toolchain.sh` must exit nonzero unless `rustc`, `solana`, `anchor`,
`surfpool`, `node`, and `yarn` are present and report the expected minimum
major/minor versions.

- [ ] **Step 5: Run the complete verification set**

Run:

```bash
./scripts/check-toolchain.sh
anchor build
yarn mocha tests/arancio.ts tests/discovery.ts tests/kamino-deposit.ts tests/jupiter-routes.ts tests/redemption.ts tests/e2e.ts
git diff --check
git status --short
```

Expected: the build and all tests pass, diff check is clean, and only intended
source/documentation files are modified.

- [ ] **Step 6: Commit the completed vertical slice**

```bash
git add README.md scripts ts tests programs Anchor.toml package.json yarn.lock Cargo.toml Cargo.lock
git commit -m "test: verify Arancio fork-first vault flows"
```

## Self-Review Checklist

- Spec coverage: the plan covers named immutable vaults, custom weights,
  arbitrary deposits, address-book indirection, Token-2022 multipliers,
  Kamino collateral receipts, Jupiter CPI, in-kind redemption, single-output
  redemption, Surfpool, and rollback tests.
- No placeholders: every task names files, interfaces, commands, and expected
  behavior; no incomplete requirement or mock protocol path is required.
- Type consistency: `AddressBook`, `VaultConfig`, `ComponentInput`,
  `ReserveDescriptor`, `BuiltRoute`, and all public helper signatures are
  introduced before later tasks consume them.
- Scope control: component count is a deployment-configured limit for Solana
  transaction safety, not a hardcoded asset restriction.
