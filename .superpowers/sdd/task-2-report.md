# Task 2 Report

## Implemented

- Added checked u128 arithmetic for weight validation, deposits, and
  proportional redemptions.
- Added `GlobalConfig`, frozen `AddressBook`, immutable named `VaultConfig`,
  and PDA-derived share mint creation.
- Kept component and input-mint addresses caller supplied; no protocol
  integration behavior was added.
- Added `ARANCIO_SURFPOOL_DB` handling while preserving the `--network mainnet`
  Surfpool datasource.
- Made the configuration test require an unfrozen address book instead of
  silently skipping that case on a reused database.

## TDD Evidence

### RED

The launcher regression test was added before changing the launcher:

```bash
set +e
tests/start-surfpool-wrapper.sh
status=$?
set -e
test "$status" -ne 0
```

It failed because `scripts/start-surfpool.sh` always forwarded
`./.surfpool/arancio.sqlite` instead of the supplied override.

After tightening the configuration test, running it against the already-used
database also failed as intended:

```text
1 passing, 1 failing
AssertionError: expected true to equal false
at tests/arancio.ts:231:46
```

This demonstrated that the previous skip was masking persistent Surfpool
state.

### GREEN

The launcher regression and shell syntax checks pass:

```bash
tests/start-surfpool-wrapper.sh
bash -n scripts/start-surfpool.sh tests/start-surfpool-wrapper.sh
git diff --check
```

Focused Rust arithmetic tests:

```bash
cargo test -p arancio math::tests
```

Result: `4 passed; 0 failed`.

Fresh-fork configuration test, using
`/tmp/opencode/arancio-task2-config2.sqlite` through
`ARANCIO_SURFPOOL_DB` and the mainnet-backed launcher:

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha tests/arancio.ts --grep "configuration|named vault|immutable"
```

Result: `2 passing`; the pre-freeze case ran and did not skip.

Anchor build:

```bash
PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH" anchor build
```

Result: release and test profiles completed successfully.

Current full tests, using a separate fresh mainnet-backed database
`/tmp/opencode/arancio-task2-full.sqlite`:

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8899 yarn test
```

Result: `3 passing`.

## Concerns

- Configuration tests require a fresh isolated Surfpool database because the
  address book and global config are intentionally immutable across runs.
- Surfpool still requires access to the public mainnet datasource.

## Review Fixes

Fixed all Task 2 review findings in:

- `README.md`
- `programs/arancio/src/errors.rs`
- `programs/arancio/src/instructions/vault.rs`
- `scripts/start-surfpool.sh`
- `tests/arancio.ts`
- `tests/start-surfpool-wrapper.sh`

The wrapper now compares every forwarded argument, including the exact
`ARANCIO_SURFPOOL_DB` path. The pre-freeze test now submits one component with
weight `10_000` and requires `AddressBookNotFrozen`. Address-book decoding now
checks all five protocol references after initialization and after freeze and
the rejected update. Vault creation now accepts an unchecked token-program
account, matches it to the frozen address book, creates the standard
`anchor_spl::token::Mint::LEN` account under that owner, and initializes it
through a dynamic token-program CPI. No external program ID is embedded in
Arancio Rust. Surfpool now defaults to `:memory:` while preserving
`--network mainnet`; `ARANCIO_SURFPOOL_DB` remains an explicit override.

### Review Fix TDD RED

The wrapper assertion was run against the pre-fix launcher:

```bash
set +e
tests/start-surfpool-wrapper.sh
status=$?
set -e
test "$status" -ne 0
```

Result: non-zero wrapper status as expected because the launcher forwarded
`./.surfpool/arancio.sqlite` instead of the supplied path.

The first dynamic-CPI compile attempt also failed before correction:

```text
error[E0308]: mismatched types
expected `Pubkey`, found `AccountInfo<'_>`
programs/arancio/src/instructions/vault.rs:93:13
programs/arancio/src/instructions/vault.rs:104:13
```

The focused integration assertion initially exposed test ordering rather than
masking it: the configured-token mismatch was attempted before freeze and
correctly returned `AddressBookNotFrozen`; the mismatch case was moved after
the freeze case before the final green run.

### Review Fix TDD GREEN

Wrapper regression and shell syntax:

```bash
tests/start-surfpool-wrapper.sh
bash -n scripts/start-surfpool.sh tests/start-surfpool-wrapper.sh
```

Result: exit status `0`.

Rust arithmetic tests:

```bash
cargo test -p arancio math::tests
```

Result: `4 passed; 0 failed`.

Fresh isolated mainnet-backed configuration test, using
`/tmp/opencode/arancio-review-fixes5.sqlite` and RPC port `8904`:

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8904 \
  yarn mocha -t 1000000 tests/arancio.ts \
  --grep 'configuration|named vault|immutable'
```

Result: `3 passing`; the pre-freeze case executed and asserted
`AddressBookNotFrozen`.

Anchor build:

```bash
PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH" anchor build
```

Result: release and test profiles completed successfully.

Fresh isolated mainnet-backed full suite, using
`/tmp/opencode/arancio-review-fixes-full.sqlite` and RPC port `8906`:

```bash
ARANCIO_RPC_URL=http://127.0.0.1:8906 yarn test
```

Result: `4 passing`.

Final hygiene check:

```bash
git diff --check
```

Result: no output and exit status `0`.
