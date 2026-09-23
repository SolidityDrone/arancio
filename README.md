# arancio / orange

Solana workspace for Stocklana: corporate-action registry + DivStrip (PT/YT) +
curve-YT discovery on Meteora DBC → DAMM v2. DivStrip builds on `ca_registry`.

## Toolchain

- Anchor CLI: 1.1.2
- Solana CLI: 3.1.10
- Surfpool: 1.5.0
- Node.js with Yarn 1.x

```bash
yarn install
```

## Reproduce locally (Surfpool + web desk)

**Full step-by-step:** [`REPRODUCE_SURFPOOL.md`](REPRODUCE_SURFPOOL.md)

Covers Surfpool start, deploy, seed `ca_registry` for KOx, launch the web app,
Phantom/Solflare signing, WSL RPC, and wallet funding on the fork.

## Local Test RPC

```bash
./scripts/start-surfpool.sh
```

Tests use `ARANCIO_RPC_URL` when set, otherwise `http://127.0.0.1:8899`.

```bash
# Workspace smoke + immutable vault config
yarn mocha tests/arancio.ts --grep "workspace smoke"

ARANCIO_SURFPOOL_DB=:memory: ./scripts/start-surfpool.sh
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha -t 1000000 tests/arancio.ts \
  --grep "configuration|named vault|immutable"

# CA registry + CRE sync
ARANCIO_RPC_URL=http://127.0.0.1:8899 \
  yarn mocha -t 180000 tests/ca-registry.ts

yarn test:anchor
```

## Programs

| Program | Role |
|---------|------|
| `ca_registry` | On-chain CA history (kind, cum factors, yield nonces) fed by CRE |
| `divstrip` | Wrap xStock → PT + YT; curve-YT vault / lcYT bridge; redeem |
| `arancio` | Named vault + share mint (ERC-4626 custody deposit) |
| `yield_cusdc` | Local cUSDC stand-in for tests (optional; main path uses Kamino) |

## Architecture (demo)

Interactive versions of these diagrams live on the landing page at
[`/`](web/) → **Architecture** (`#architecture`).

Brand marks used below live in [`docs/diagrams/brand/`](docs/diagrams/brand/).

### 1 — Split path: oracle → contracts → redeem

Users deposit an xStock and receive **strip PT** (capital) + **strip YT** (yield)
for one yield nonce. Chainlink CRE reads the **xStocks API**, labels each CA, and
writes `ca_registry` so DivStrip freezes the right coupon — not raw multiplier noise.

```mermaid
sequenceDiagram
  autonumber
  participant XS as xStocks API
  participant CRE as Chainlink CRE
  participant Reg as ca_registry
  participant User as Trader
  participant DS as divstrip
  participant Mkt as StripMarket PDA
  participant Ser as StripSeries (nonce n)
  participant V as xStock vault
  participant PT as strip PT mint
  participant YT as strip YT mint

  CRE->>XS: read CA calendar
  XS-->>CRE: typed corporate actions
  CRE->>Reg: sync events (yield vs supply)
  Note over Reg: tip · cum_y · current_yield_nonce

  User->>DS: initialize_strip / create_series
  DS->>Mkt: market PDA
  DS->>Ser: series for nonce n

  User->>DS: wrap(amount)
  DS->>V: lock xStock
  DS->>PT: mint 1:1
  DS->>YT: mint 1:1

  Note over User,YT: Trade legs off-protocol or later AMMs

  Reg-->>DS: tip passes n (mature at n+1)
  User->>DS: redeem_capital / redeem_yield
  DS->>V: unlock underlying by frozen Ys/Yt
  DS->>PT: burn
  DS->>YT: burn
```

**On-chain pieces (split)**

```mermaid
flowchart LR
  subgraph Offchain["Off-chain oracle path"]
    XS["<img src='https://cdn.jsdelivr.net/gh/SolidityDrone/arancio@Rehydratation/docs/diagrams/brand/xstocks.svg' width='40' height='40' /><br/>xStocks API"]
    CRE["<img src='https://cdn.jsdelivr.net/gh/SolidityDrone/arancio@Rehydratation/docs/diagrams/brand/chainlink.svg' width='40' height='40' /><br/>Chainlink CRE"]
  end

  subgraph Onchain["On-chain DivStrip"]
    REG[ca_registry]
    DIV[divstrip]
    M[StripMarket]
    S[StripSeries n]
    VX[xStock vault]
    PT[strip PT]
    YT[strip YT]
    TOK[xStock mint]
  end

  XS -->|CA calendar| CRE
  CRE -->|typed events<br/>yield vs supply| REG
  REG -->|nonce · cum_y| DIV
  DIV --> M
  DIV --> S
  TOK -->|wrap| VX
  DIV -->|mint 1:1| PT
  DIV -->|mint 1:1| YT
  PT -->|redeem capital| TOK
  YT -->|redeem yield| TOK
```

### 2 — Curve market: DBC, vault, graduation

**curve-YT** is a Meteora discovery token (USDC pair) — not strip YT.
Bonders **swap USDC → curve-YT on DBC**, then **deposit curve-YT into the DivStrip
vault** and receive **lcYT** shares. The vault does **not** pull curve-YT from
Meteora directly — the trader’s wallet is the bridge hop.
Graduation (DBC → DAMM) and strip maturity are **different clocks**.
Idle vault USDC can later park in **Kamino cUSDC**.

```mermaid
sequenceDiagram
  autonumber
  participant Ops as Launch backend
  participant Met as Meteora DBC
  participant DS as divstrip
  participant Br as curve-YT vault
  participant User as Bonder
  participant DAMM as DAMM v2
  participant Kam as Kamino cUSDC

  Ops->>Met: createConfig + createPool (USDC ↔ curve-YT)
  Ops->>DS: register_curve_launch
  Ops->>DS: init_curve_bridge
  DS->>Br: vault ready

  User->>Met: 1. swap USDC → curve-YT
  Met-->>User: curve-YT in wallet
  User->>DS: 2. deposit_curve_yt_for_shares
  DS->>Br: 3. vault holds curve-YT
  DS-->>User: 4. mint lcYT

  Note over Met: quote reserve → migration mcap

  Met->>DAMM: graduate liquidity
  Note over DAMM: still curve-YT ↔ USDC

  opt After fill / graduation
    Br->>Kam: park idle USDC as cUSDC
  end
```

**System map (curve + graduation)**

```mermaid
flowchart TB
  subgraph Desk["Desk"]
    U[Trader · pays USDC]
    API["<img src='https://cdn.jsdelivr.net/gh/SolidityDrone/arancio@Rehydratation/docs/diagrams/brand/server.svg' width='40' height='40' /><br/>Launch backend"]
  end

  subgraph Met["Meteora"]
    DBC["<img src='https://cdn.jsdelivr.net/gh/SolidityDrone/arancio@Rehydratation/docs/diagrams/brand/meteora.svg' width='40' height='40' /><br/>DBC bonding"]
    DAMM["<img src='https://cdn.jsdelivr.net/gh/SolidityDrone/arancio@Rehydratation/docs/diagrams/brand/meteora.svg' width='40' height='40' /><br/>DAMM v2"]
  end

  subgraph Div["DivStrip"]
    DS[divstrip<br/>register + init vault]
    BR[curve-YT vault<br/>holds curve-YT · mints lcYT]
    SW[swap strip YT ↔ curve-YT]
  end

  subgraph Yield["Vault yield park"]
    K["<img src='https://cdn.jsdelivr.net/gh/SolidityDrone/arancio@Rehydratation/docs/diagrams/brand/kamino.svg' width='40' height='40' /><br/>Kamino cUSDC"]
  end

  API -->|create pool| DBC
  API -->|register_curve_launch<br/>+ init_curve_bridge| DS
  DS --> BR

  U -->|1. USDC swap| DBC
  DBC -->|2. curve-YT to wallet| U
  U -->|3. deposit curve-YT| BR
  BR -->|4. mint lcYT| U

  DBC -->|graduate| DAMM
  BR -.->|park idle USDC| K
  SW --- BR
```

### Two clocks

| Clock | What ends it | Where |
|-------|----------------|-------|
| Bonding / graduation | Quote fill hits migration mcap | Meteora DBC → DAMM |
| Strip maturity | Registry tip passes yield nonce n | DivStrip + `ca_registry` |

## DivStrip web desk

Stocklana-styled landing + strip UI at `http://127.0.0.1:3000` (`yarn web` or `cd web && npm run dev`).

- `/` — overview, **Architecture** diagrams, curve-YT lifecycle, CRE story
- `/app` — Split xStock → PT/YT, launch curve-YT on Meteora DBC, vault buy/sell

Wallets: **Phantom or Solflare** (sign txs in-app). See
[`REPRODUCE_SURFPOOL.md`](REPRODUCE_SURFPOOL.md) for RPC, funding, and registry seed steps.

Meteora curve: initial mcap ≈ f(fair coupon `1 − Yₛ/Yₜ`), migration ≈ 10×, quote **USDC**.
Requires Surfpool `--network mainnet` so DBC program
`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` is on the fork.

Vault-side yield park uses **Kamino** main-market cUSDC (users still trade USDC on the desk).
