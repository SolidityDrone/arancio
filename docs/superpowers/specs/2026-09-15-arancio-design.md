# Arancio: Fork-First Basket Vault Design

Date: 2026-09-15
Status: Draft for written-spec review

## Summary

Arancio is a Solana basket-vault protocol for xStocks and other supported
Token-2022 assets. A vault creator names a vault, selects component mints, and
sets immutable target weights. A depositor supplies an arbitrary amount of the
vault input mint. The vault swaps that input into the weighted components,
supplies the components to Kamino Borrow & Lend, and mints Arancio share tokens
to represent proportional ownership.

On redemption, the vault withdraws the depositor's proportional underlying
positions plus accrued lending yield. It can return the basket in kind or swap
the basket into a caller-selected output mint such as USDC.

All chain-dependent development and integration testing uses a local
mainnet-backed Surfpool instance. No devnet deployment or mocked swap/lending
path is part of the MVP.

## Verified Findings

| Area | Finding | Status |
| --- | --- | --- |
| Vault standard | Solana has no chain-wide ERC-4626 standard. The Solana ERC-4626 material is an implementation pattern for a single underlying asset. | Verified |
| Basket model | A multi-asset vault needs a custom interface. It may expose ERC-4626-shaped preview and share-accounting methods without claiming ERC-4626 compliance. | Verified |
| xStocks | Solana xStocks use Token-2022 `ScaledUiAmount`. Raw token-account balances remain constant while the displayed amount applies the active multiplier. | Verified |
| Corporate actions | Dividends, forward splits, and reverse splits are represented by multiplier updates. The effective timestamp selects the active multiplier. | Verified |
| Kamino xStocks | The live Kamino xStocks market has reserves for multiple xStocks and exposes reserve-level supply configuration. The set of enabled reserves can change. | Verified from live API; must be revalidated |
| Kamino receipt | Kamino Borrow & Lend deposits use reserve collateral receipts and an obligation position. These are distinct from Kamino Liquidity `kTokens`. | Verified |
| Swaps | Jupiter Swap API V2 `/build` returns raw instructions for custom transactions. Jupiter documents CPI, but CPI routes cannot use Address Lookup Tables. | Verified |
| Local fork | Surfpool is a local Solana simulator with mainnet account fetching, full RPC endpoints, and local program execution. It is the preferred dApp/integration environment. | Verified |

## Goals

- Let anyone create a named basket vault with custom component mints and
  immutable weights.
- Keep the vault share token as the only Arancio-issued ownership receipt.
- Execute deposits, Kamino supply, redemptions, and optional swaps atomically
  where Solana transaction and compute limits allow.
- Use real mainnet xStocks, Jupiter routes, and Kamino program state through a
  local fork for development and tests.
- Account for Kamino lending yield and xStocks multiplier changes without
  rebasing Arancio shares.
- Avoid hardcoded asset symbols, token mints, external protocol IDs, and
  network-specific addresses in core logic.

## Non-Goals

- Public mainnet launch during the hackathon.
- A claim that Arancio implements canonical ERC-4626 for a multi-asset vault.
- A hardcoded catalog of stocks or a hardcoded list of enabled reserves.
- A mocked protocol adapter used as the normal deposit or redemption path.
- Borrowing against the basket. The MVP supplies components to Kamino without
  opening a debt position.

## System Design

### On-chain programs and accounts

The Arancio program owns the following state:

- `GlobalConfig` PDA: points to the deployment's immutable address book and
  stores deployment limits such as the maximum component count.
- `AddressBook` account: stores the external program IDs and network-specific
  infrastructure addresses required by Arancio. It is initialized during
  deployment and frozen before vault creation.
- `VaultConfig` PDA: stores the vault name, input mint, component mints,
  immutable weights, Kamino market/reserve references, share mint, and vault
  authority bump. It cannot be changed after initialization.
- Vault authority PDA: owns the vault's component token accounts, Kamino
  collateral receipt accounts, and obligation position.
- Arancio share mint: a conventional SPL share mint whose mint and burn
  authority is the vault authority PDA.

The vault creator supplies component and reserve accounts at creation. The
program verifies that each component mint matches its Kamino reserve, the
reserve belongs to the configured market, the reserve supports supply, and all
accounts are owned by the expected programs. The program does not identify
assets by symbol.

The client has an `addresses` helper. It reads the frozen address book for the
selected network and provides typed addresses to deployment, transaction
builders, and tests. It may contain human-readable aliases, but core program
logic receives and validates accounts rather than embedding those aliases or
addresses.

### Vault creation

`create_vault` accepts:

- A human-readable vault name with a bounded byte length.
- The vault input mint.
- A non-empty component list.
- One weight per component, summing to `10_000` basis points.
- Kamino market, reserve, collateral-mint, and obligation configuration.
- The frozen address-book reference.

The creator may choose any component set that passes the on-chain Kamino
checks. A deployment limit on component count exists for transaction size and
compute safety; it is stored in `GlobalConfig`, not hardcoded as an asset rule.
Weights, component order, input mint, name, and protocol references are
immutable after creation.

### Deposit flow

For an arbitrary input amount:

1. The caller supplies the input mint, amount, receiver, per-component swap
   routes, and minimum acceptable outputs.
2. The program transfers the input amount into the vault authority's custody.
3. For each component, the program CPI-calls the validated Jupiter router with
   the component's route accounts and destination token account.
4. The program checks the raw Token-2022 output delta and minimum amount.
5. The program CPI-calls Kamino Borrow & Lend to supply each component. Kamino
   collateral receipts are directed to vault-owned accounts and the vault
   obligation is updated.
6. The program calculates the value actually added, calculates shares using
   checked fixed-point arithmetic, and mints shares to the receiver.
7. Any failure aborts the transaction, including swaps already executed in the
   same transaction.

The target component value is derived from the immutable weights. The caller
does not need to deposit a fixed amount or match a fixed example basket.
Rounding and residual input handling are explicit and must not silently alter
the target allocation.

### NAV and share accounting

NAV is the value of the vault's redeemable positions plus idle balances in the
configured accounting unit. The implementation must use the Kamino reserve and
obligation state to determine the current withdrawable component amount rather
than treating a collateral receipt's raw amount as the underlying amount.

xStocks are always transacted in raw base units. The implementation reads the
Token-2022 `ScaledUiAmountConfig` and selects the active multiplier using the
effective timestamp. The multiplier is used for user-facing and accounting
conversion only; it is not used as a token transfer amount.

Before finalizing NAV, integration tests must establish whether the selected
Kamino oracle value already includes the xStocks multiplier. Arancio must use
one consistent source of truth and must not multiply a value twice.

Shares do not rebase. Kamino interest, xStocks corporate actions, and market
price movement increase or decrease NAV per share. Deposit and redemption
instructions expose minimum-share, minimum-output, or maximum-input bounds to
protect users from price movement and route slippage.

### Redemption flow

The caller burns a specified share amount and selects a receiver and output
mode.

**In-kind mode:**

1. Calculate each component's proportional claim.
2. Withdraw the required underlying amount from Kamino.
3. Transfer the raw Token-2022 component amounts to the receiver.

**Single-output mode:**

1. Calculate each component's proportional claim.
2. Withdraw the required underlying amount from Kamino.
3. CPI-call Jupiter for each component-to-output route.
4. Enforce the caller's aggregate and per-route minimums.
5. Transfer the selected output mint to the receiver.

Redemption must remain available when a reserve disables new supply. New
deposits must fail closed if a configured reserve is paused or no longer
accepts supply. A reserve's live status is checked at the time of each state
changing instruction.

## Protocol Integration

### Jupiter

The client calls Jupiter Swap API V2 `/build` to obtain raw Metis route
instructions. It passes the route data and accounts into the Arancio
instruction. The Arancio program validates the Jupiter program ID through the
frozen address book, validates destination accounts, and checks post-swap raw
balance deltas.

Routes must be constrained with account and compute limits. Jupiter CPI cannot
use Address Lookup Tables, so an oversized route is rejected before signing.
The client must simulate the complete transaction, including the vault
instruction, before presenting it to the wallet.

### Kamino Borrow & Lend

Each component is supplied to its configured Kamino reserve. The vault owns
the destination collateral receipt account and the lending obligation. Kamino
collateral receipts are internal position claims, not user-facing Arancio
shares and not automatically Kamino Liquidity `kTokens`.

The UI derives eligible components from live reserve configuration. A symbol
or API listing alone is insufficient: the client and program must verify the
reserve, liquidity mint, collateral mint, market, oracle, and supply status.

### Token programs

Component mints may use Token-2022. The share mint uses the legacy SPL Token
program unless a concrete extension requirement justifies Token-2022. Every
token account includes and validates its token-program ID; the program must
not assume that all assets use the legacy program.

## Fork-First Development

Surfpool is the shared environment for browser, wallet, RPC, and integration
tests:

```bash
surfpool start \
  --rpc-url "$MAINNET_RPC_URL" \
  --db ./.surfpool/arancio.sqlite \
  --no-tui
```

The application uses Surfpool's local HTTP and WebSocket endpoints. Jupiter's
remote `/build` response supplies instructions, but the client discards its
remote blockhash and compiles the final transaction with a blockhash from
Surfpool. Mainnet Address Lookup Tables can be used by the outer versioned
transaction where applicable; they are not available inside Jupiter CPI.

`solana-test-validator --clone` is not the primary environment. It performs
one-time account cloning and requires every dependency to be named manually.
It may be used for small deterministic fixtures, but it must not be described
as a complete mainnet fork.

## Test Strategy

All protocol integration tests use Surfpool and real deployed program IDs.
Pure arithmetic tests may run without a chain.

Required scenarios:

- Create a named vault with custom components and weights.
- Reject weights that do not sum to `10_000` basis points.
- Reject mismatched mints, reserves, markets, token programs, and address-book
  entries.
- Deposit multiple arbitrary amounts and verify weighted raw outputs.
- Verify Kamino collateral receipts and obligation deposits after supply.
- Verify share minting against actual value added, including rounding bounds.
- Verify NAV changes after Kamino reserve refresh without share rebasing.
- Verify active xStocks multipliers and scheduled multiplier timestamps.
- Redeem in kind and compare raw component amounts with the proportional claim.
- Redeem to a caller-selected output mint with Jupiter routes and `min_out`.
- Fail and roll back on route slippage, unsupported routes, paused reserves,
  account mismatches, and insufficient compute or account capacity.
- Confirm that a supply-disabled reserve blocks new deposits but does not block
  redemption.

## Main Caveats

- The enabled xStocks set and Kamino risk parameters are live configuration,
  not stable application constants. The UI and program must revalidate them.
- Example basket symbols are illustrative only. A requested component may not
  have an enabled Kamino reserve when the vault is created.
- xStocks multiplier handling and Kamino oracle pricing must be tested together
  to avoid double counting or missing corporate actions.
- Jupiter CPI routes have strict account and compute limits. Large baskets may
  require a smaller configured component limit, in-kind redemption, or a later
  asynchronous rebalance design.
- A frozen address book prevents accidental configuration drift but does not
  prevent an external protocol program from being upgraded at the same program
  ID. The hackathon deployment must record the selected program and account
  versions in its test fixture metadata.
- Surfpool is fork-like rather than a complete historical validator snapshot.
  Lazy-fetched accounts may reflect different upstream slots unless the test
  fixture pins and records its upstream state.
- A Kamino supply-only position has no debt liquidation path, but it remains
  exposed to reserve, oracle, protocol, and underlying-asset risks.

## Acceptance Criteria

The design is ready for implementation when the repository can:

1. Start a documented Surfpool mainnet-backed endpoint.
2. Discover a live Kamino reserve and construct a frozen address-book fixture
   without hardcoded protocol or asset IDs in vault logic.
3. Create a named, custom-weight vault.
4. Complete an arbitrary deposit through real Jupiter and Kamino CPIs.
5. Mint Arancio shares against the resulting basket position.
6. Redeem either raw component assets or a caller-selected output mint.
7. Demonstrate yield and multiplier-aware NAV without rebasing shares.
8. Run the failure and rollback cases against the same fork environment.

## Sources

- [Solana Surfpool](https://solana.com/docs/tools/surfpool)
- [Surfnet RPC](https://docs.surfpool.run/rpc/overview)
- [Anza test validator](https://docs.anza.xyz/cli/examples/test-validator)
- [What is ERC-4626 on Solana?](https://solana.com/developers/migrate-to-solana/erc4626)
- [Solana Token-2022 Scaled UI Amount](https://solana.com/docs/tokens/extensions/scaled-ui-amount)
- [xStocks multiplier guide](https://docs.xstocks.fi/developers/multipliers)
- [Live Kamino xStocks market](https://api.kamino.finance/v2/kamino-market/5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua)
- [Live Kamino reserve metrics](https://api.kamino.finance/kamino-market/5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua/reserves/metrics)
- [Kamino deposit operations](https://kamino.com/docs/build/developers/borrow/operations/deposit)
- [Kamino KLend source](https://github.com/Kamino-Finance/klend)
- [Jupiter Swap API V2 build](https://developers.jup.ag/docs/swap/build)
- [Jupiter custom instruction and CPI constraints](https://developers.jup.ag/docs/swap/build/common-instructions)
- [Jupiter CPI example](https://github.com/jup-ag/jupiter-cpi-swap-example)
