# arancio

## Toolchain

- Anchor CLI: 1.1.2
- Solana CLI: 3.1.10
- Surfpool: 1.5.0
- Node.js with Yarn 1.x

Install JavaScript dependencies with Yarn:

```bash
yarn install
```

## Local Test RPC

Start the direct mainnet-backed Surfpool smoke-test endpoint in a separate
terminal:

```bash
./scripts/start-surfpool.sh
```

The launcher uses an isolated in-memory database by default, so configuration
tests can be rerun without deleting state. Set `ARANCIO_SURFPOOL_DB` to an
explicit SQLite path when persistence is needed; the datasource remains
mainnet-backed in either case.

The tests use `ARANCIO_RPC_URL` when set, otherwise they connect to
`http://127.0.0.1:8899`.
The smoke test compares the local RPC genesis hash with the fixed official
mainnet-beta RPC endpoint.

Run the direct workspace smoke test:

```bash
yarn mocha tests/arancio.ts --grep "workspace smoke"
```

Run the immutable-configuration tests against a fresh isolated Surfpool
instance without deleting any database state:

```bash
ARANCIO_SURFPOOL_DB=:memory: ./scripts/start-surfpool.sh
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha -t 1000000 tests/arancio.ts \
  --grep "configuration|named vault|immutable"
```

Run Anchor integration tests only through the explicit Surfpool wrapper. This
prevents the test command from falling back to the legacy
`solana-test-validator`:

```bash
yarn test:anchor
```

## Live Kamino Discovery

The discovery client uses the Kamino API only for reserve candidates. It reads
the reserve, mint, oracle, and token-program state from the local mainnet-backed
Surfpool RPC before returning a supply-enabled reserve. Supply the deployment
market and address-book accounts explicitly:

```bash
ARANCIO_KAMINO_MARKET="$KAMINO_MARKET" \
ARANCIO_PROGRAM_ID="$ARANCIO_PROGRAM_ID" \
ARANCIO_ADDRESS_BOOK="$ARANCIO_ADDRESS_BOOK" \
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha tests/discovery.ts
```

`ARANCIO_KAMINO_API_URL` may override the Kamino API host when required. The
client does not identify assets by symbols or embed token, protocol, or market
IDs.

Build the empty bootstrap program:

```bash
anchor build
```

Anchor's Surfpool test configuration uses Surfpool's mainnet-backed datasource
while keeping the RPC local. The direct smoke-test launcher remains available
for validating the standalone Surfpool RPC.
