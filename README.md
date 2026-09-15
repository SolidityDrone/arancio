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

The tests use `ARANCIO_RPC_URL` when set, otherwise they connect to
`http://127.0.0.1:8899`.

Run the direct workspace smoke test:

```bash
yarn mocha tests/arancio.ts --grep "workspace smoke"
```

Run Anchor integration tests only through the explicit Surfpool wrapper. This
prevents the test command from falling back to the legacy
`solana-test-validator`:

```bash
yarn test:anchor
```

Build the empty bootstrap program:

```bash
anchor build
```

Anchor's Surfpool test configuration is offline and does not require a public
cluster. The direct smoke-test launcher remains available for validating the
standalone Surfpool RPC.
