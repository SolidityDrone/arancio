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

Start the mainnet-backed local Surfpool endpoint in a separate terminal:

```bash
./scripts/start-surfpool.sh
```

The tests use `ARANCIO_RPC_URL` when set, otherwise they connect to
`http://127.0.0.1:8899`.

Run the workspace smoke test and build:

```bash
yarn mocha tests/arancio.ts --grep "workspace smoke"
anchor build
```

All workspace commands use the local provider and do not require a public
cluster.
