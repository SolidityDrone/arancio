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
    XS["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJ4U3RvY2tzIj4KICA8cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzBCMEIwRiIvPgogIDxwYXRoIGZpbGw9IiNGNUY1RjciIGQ9Ik0xOCAxNmg4LjJMMzIgMjguNCAzNy44IDE2SDQ2bC05LjQgMTZMNDYgNDhoLTguMkwzMiAzNS42IDI2LjIgNDhIMThsOS40LTE2TDE4IDE2eiIvPgogIDxjaXJjbGUgY3g9IjQ4IiBjeT0iNDgiIHI9IjUiIGZpbGw9IiMxNEYxOTUiLz4KPC9zdmc+Cg==' width='40' height='40' /><br/>xStocks API"]
    CRE["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJDaGFpbmxpbmsiPgogIDxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjE0IiBmaWxsPSIjMEIwQjBGIi8+CiAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTMuMSAxMy4xKSBzY2FsZSgxKSI+CiAgICA8cGF0aCBmaWxsPSIjMzc1QkQyIiBkPSJNMTguOSAwbC00IDIuM0w0IDguNmwtNCAyLjNWMzIuN0w0IDM1bDExIDYuMyA0IDIuMyA0LTIuM0wzMy44IDM1bDQtMi4zVjEwLjlsLTQtMi4zLTEwLjktNi4zLTQtMi4zek04IDI4LjFWMTUuNWwxMC45LTYuMyAxMC45IDYuM3YxMi42bC0xMC45IDYuM0w4IDI4LjF6Ii8+CiAgPC9nPgo8L3N2Zz4K' width='40' height='40' /><br/>Chainlink CRE"]
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
    API["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJTZXJ2ZXIiPgogIDxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjEyIiBmaWxsPSIjMDYxMDE4Ii8+CiAgPHJlY3QgeD0iMTIiIHk9IjE0IiB3aWR0aD0iNDAiIGhlaWdodD0iMTIiIHJ4PSIyIiBmaWxsPSJub25lIiBzdHJva2U9IiMxNEYxOTUiIHN0cm9rZS13aWR0aD0iMiIvPgogIDxyZWN0IHg9IjEyIiB5PSIzMCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjEyIiByeD0iMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTRGMTk1IiBzdHJva2Utd2lkdGg9IjIiLz4KICA8cmVjdCB4PSIxMiIgeT0iNDYiIHdpZHRoPSI0MCIgaGVpZ2h0PSIxMiIgcng9IjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwRDFGRiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPGNpcmNsZSBjeD0iMTgiIGN5PSIyMCIgcj0iMiIgZmlsbD0iIzE0RjE5NSIvPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iMzYiIHI9IjIiIGZpbGw9IiMxNEYxOTUiLz4KICA8Y2lyY2xlIGN4PSIxOCIgY3k9IjUyIiByPSIyIiBmaWxsPSIjMDBEMUZGIi8+Cjwvc3ZnPgo=' width='40' height='40' /><br/>Launch backend"]
  end

  subgraph Met["Meteora"]
    DBC["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJNZXRlb3JhIj4KICA8cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzBCMEIwRiIvPgogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE0LjUgMTQuNSkgc2NhbGUoMSkiPgogICAgPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xOC44MDM1IDMuODE5MUwxOC44MDkyIDMuODEzM0MxNy4wOTY0IDMuODQ1NCAxNS40NDIgNC4zMDY4NSAxNC4wMTkyIDUuMjA5M0MxMi45NTIyIDYuMzQzODEgMTEuOTA4IDcuNTAxMTggMTAuODk3NSA4LjY5MDI2QzkuNzk3MzUgOS45ODE5NSA4LjczNjE0IDExLjMwODggNy43MjY2NCAxMi42Nzk3QzcuMzUxMDUgMTMuMTk0NiA2Ljk4MTA0IDEzLjcxNyA2LjYzMTcxIDE0LjI2MDFDNy4xNzQ3OSAxMy45MTA3IDcuNjk3MTkgMTMuNTQwNyA4LjIxMjExIDEzLjE2NTFDOC44MTk2IDEyLjcxNjYgOS40MTkzMyAxMi4yNTgzIDEwLjAxMDQgMTEuNzkxNEMxMi44OTkxIDkuNTEyMiAxNS42MDU4IDcuMDE2NjYgMTguMjA1OCA0LjQyNzY0QzE4LjQwNTQgNC4yMjU4MSAxOC42MDQgNC4wMjI5MyAxOC44MDM1IDMuODE5MVpNMTcuNTIyNyAxMC41OTk1QzE5LjQ0OTggOC42NTA1OSAyMS4zNTkxIDYuNjc4MTcgMjMuMjE0NCA0LjY1NzQ1QzIyLjQzOTggNC4zNDEzOSAyMS42NDQ2IDQuMTEzMyAyMC44NDg1IDMuOTc1NTFDMTkuMTMxNCA1LjU3NTAyIDE3LjQ0NzEgNy4yMDkyMiAxNS43ODExIDguODU3ODVDMTMuODY0MiAxMC43OTIyIDExLjk2NjIgMTIuNzUxMiAxMC4xMjIyIDE0Ljc1ODRDNy40NDgxOSAxNy42NjUzIDQuODgyNTEgMjAuNjczIDIuNTIzNjQgMjMuODU2OUM1LjM5OTk5IDIxLjcyNTEgOC4xMzQxNCAxOS40MjY0IDEwLjc3NzQgMTcuMDI5MUMxMy4wODExIDE0Ljk0MzEgMTUuMzE4IDEyLjc4NDYgMTcuNTIyNyAxMC41OTk1Wk0yNi41MjIgNi42NzA2MkMyMy44MDIyIDkuNjgyMSAyMC45ODE4IDEyLjYwMDUgMTguMTI3MyAxNS40ODExQzE2LjQxNSAxNy4xODA0IDE0LjY4OTUgMTguODY2NyAxMi45Mzg5IDIwLjUyNTlDOS4xMTUxIDI0LjE1MTUgNS4xNzIyNiAyNy42NTI0IDAuOTg3NjE1IDMwLjg3OTJDNC4yODgxNiAyNi41OTkgNy44NzU3NyAyMi41NzE2IDExLjU5MDMgMTguNjY1NUMxMy4xNzAzIDE3LjAwNSAxNC43NzIgMTUuMzY2MiAxNi4zODU3IDEzLjczOTVDMTkuMTk0OSAxMC45NTY0IDIyLjA0MDggOC4yMDQxNSAyNC45NzIyIDUuNTQ3MDVDMjUuNTA4IDUuODc1NDggMjYuMDI2NiA2LjI0OTQ3IDI2LjUyMiA2LjY3MDYyWk0yOS4wODEzIDkuNjE5MTNDMjguNzQ5MSA5LjA4NzEgMjguMzcwMyA4LjU3MzI2IDI3Ljk0NjUgOC4wODI3OEMyNC45MzMxIDEwLjgwNDQgMjIuMDExOCAxMy42Mjc3IDE5LjEyOTMgMTYuNDg0MUMxNy40MjkxIDE4LjE5NzQgMTUuNzQwOSAxOS45MjQ4IDE0LjA3OTggMjEuNjc3M0MxMC40NTUxIDI1LjUwMDEgNi45NTcxNyAyOS40NDIyIDMuNzMxMjMgMzMuNjIzOEM4LjAwMzY5IDMwLjMyODggMTIuMDI1NSAyNi43NDkgMTUuOTI1IDIzLjA0MTFDMTcuNTkyMSAyMS40NTQ1IDE5LjIzNzUgMTkuODQ2MSAyMC44NzEgMTguMjI1N0MyMy42NjA3IDE1LjQwOTggMjYuNDE4NiAxMi41NTgzIDI5LjA4MTMgOS42MTkxM1pNMjkuOTgzNCAxMS4zNjU4QzMwLjMwNTggMTIuMTI5NyAzMC41NDE0IDEyLjkxNTEgMzAuNjg4NyAxMy43MDE4QzI5LjA3MjMgMTUuNDQgMjcuNDE3MSAxNy4xNDMyIDI1Ljc0OTUgMTguODMwM0MyMy43OTYyIDIwLjc2NjMgMjEuODE3MSAyMi42ODIyIDE5Ljc4ODcgMjQuNTQ1MUMxNi45MDA4IDI3LjIwMDEgMTMuOTEyMSAyOS43NDQ3IDEwLjc1MDQgMzIuMDg3OEMxMi44NzE5IDI5LjIyMzkgMTUuMTYwMyAyNi41MDIzIDE3LjU0NzEgMjMuODY5NUMxOS42NDE1IDIxLjU1MzEgMjEuODExNCAxOS4zMDQ4IDI0LjAwNzkgMTcuMDg4N0MyNS45NjczIDE1LjE1MTEgMjcuOTUwMSAxMy4yMzE0IDI5Ljk4MzQgMTEuMzY1OFpNMjkuNjk3MSAyMC4zMDRDMzAuNDgxMiAxOC45MTkgMzAuODcxNyAxNy4zNDIgMzAuODc3MSAxNS43MTQ4QzMwLjY0MjYgMTUuOTQyNyAzMC40MDkzIDE2LjE3MTcgMzAuMTc3OSAxNi40MDA4QzI3LjU1OTQgMTkuMDMwMiAyNS4wMzc1IDIxLjc2NzcgMjIuNzM3NCAyNC42OTI2QzIyLjI5NjggMjUuMjUyOSAyMS44NjQ4IDI1LjgxOTkgMjEuNDQwNSAyNi4zOTQ1QzIxLjA2MzkgMjYuOTEwNCAyMC42OTQ5IDI3LjQzMTggMjAuMzQ1NSAyNy45NzQ5QzIwLjg4ODYgMjcuNjI1NiAyMS40MTEgMjcuMjU1NSAyMS45MjU5IDI2Ljg4QzIzLjE4NTUgMjUuOTUxMyAyNC40MDk3IDI0Ljk3OTcgMjUuNjAzMSAyMy45NzM1QzI3LjAwNjEgMjIuNzkyNSAyOC4zNjc0IDIxLjU2NCAyOS42OTcxIDIwLjMwNFoiIGZpbGw9InVybCgjbSkiLz4KICA8L2c+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Im0iIHgxPSIyNSIgeTE9IjcwIiB4Mj0iNjEiIHkyPSIyNyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBzdG9wLWNvbG9yPSIjRkYyMTg5Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0ZGOUQwMCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+Cjwvc3ZnPgo=' width='40' height='40' /><br/>DBC bonding"]
    DAMM["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJNZXRlb3JhIj4KICA8cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iIzBCMEIwRiIvPgogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE0LjUgMTQuNSkgc2NhbGUoMSkiPgogICAgPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xOC44MDM1IDMuODE5MUwxOC44MDkyIDMuODEzM0MxNy4wOTY0IDMuODQ1NCAxNS40NDIgNC4zMDY4NSAxNC4wMTkyIDUuMjA5M0MxMi45NTIyIDYuMzQzODEgMTEuOTA4IDcuNTAxMTggMTAuODk3NSA4LjY5MDI2QzkuNzk3MzUgOS45ODE5NSA4LjczNjE0IDExLjMwODggNy43MjY2NCAxMi42Nzk3QzcuMzUxMDUgMTMuMTk0NiA2Ljk4MTA0IDEzLjcxNyA2LjYzMTcxIDE0LjI2MDFDNy4xNzQ3OSAxMy45MTA3IDcuNjk3MTkgMTMuNTQwNyA4LjIxMjExIDEzLjE2NTFDOC44MTk2IDEyLjcxNjYgOS40MTkzMyAxMi4yNTgzIDEwLjAxMDQgMTEuNzkxNEMxMi44OTkxIDkuNTEyMiAxNS42MDU4IDcuMDE2NjYgMTguMjA1OCA0LjQyNzY0QzE4LjQwNTQgNC4yMjU4MSAxOC42MDQgNC4wMjI5MyAxOC44MDM1IDMuODE5MVpNMTcuNTIyNyAxMC41OTk1QzE5LjQ0OTggOC42NTA1OSAyMS4zNTkxIDYuNjc4MTcgMjMuMjE0NCA0LjY1NzQ1QzIyLjQzOTggNC4zNDEzOSAyMS42NDQ2IDQuMTEzMyAyMC44NDg1IDMuOTc1NTFDMTkuMTMxNCA1LjU3NTAyIDE3LjQ0NzEgNy4yMDkyMiAxNS43ODExIDguODU3ODVDMTMuODY0MiAxMC43OTIyIDExLjk2NjIgMTIuNzUxMiAxMC4xMjIyIDE0Ljc1ODRDNy40NDgxOSAxNy42NjUzIDQuODgyNTEgMjAuNjczIDIuNTIzNjQgMjMuODU2OUM1LjM5OTk5IDIxLjcyNTEgOC4xMzQxNCAxOS40MjY0IDEwLjc3NzQgMTcuMDI5MUMxMy4wODExIDE0Ljk0MzEgMTUuMzE4IDEyLjc4NDYgMTcuNTIyNyAxMC41OTk1Wk0yNi41MjIgNi42NzA2MkMyMy44MDIyIDkuNjgyMSAyMC45ODE4IDEyLjYwMDUgMTguMTI3MyAxNS40ODExQzE2LjQxNSAxNy4xODA0IDE0LjY4OTUgMTguODY2NyAxMi45Mzg5IDIwLjUyNTlDOS4xMTUxIDI0LjE1MTUgNS4xNzIyNiAyNy42NTI0IDAuOTg3NjE1IDMwLjg3OTJDNC4yODgxNiAyNi41OTkgNy44NzU3NyAyMi41NzE2IDExLjU5MDMgMTguNjY1NUMxMy4xNzAzIDE3LjAwNSAxNC43NzIgMTUuMzY2MiAxNi4zODU3IDEzLjczOTVDMTkuMTk0OSAxMC45NTY0IDIyLjA0MDggOC4yMDQxNSAyNC45NzIyIDUuNTQ3MDVDMjUuNTA4IDUuODc1NDggMjYuMDI2NiA2LjI0OTQ3IDI2LjUyMiA2LjY3MDYyWk0yOS4wODEzIDkuNjE5MTNDMjguNzQ5MSA5LjA4NzEgMjguMzcwMyA4LjU3MzI2IDI3Ljk0NjUgOC4wODI3OEMyNC45MzMxIDEwLjgwNDQgMjIuMDExOCAxMy42Mjc3IDE5LjEyOTMgMTYuNDg0MUMxNy40MjkxIDE4LjE5NzQgMTUuNzQwOSAxOS45MjQ4IDE0LjA3OTggMjEuNjc3M0MxMC40NTUxIDI1LjUwMDEgNi45NTcxNyAyOS40NDIyIDMuNzMxMjMgMzMuNjIzOEM4LjAwMzY5IDMwLjMyODggMTIuMDI1NSAyNi43NDkgMTUuOTI1IDIzLjA0MTFDMTcuNTkyMSAyMS40NTQ1IDE5LjIzNzUgMTkuODQ2MSAyMC44NzEgMTguMjI1N0MyMy42NjA3IDE1LjQwOTggMjYuNDE4NiAxMi41NTgzIDI5LjA4MTMgOS42MTkxM1pNMjkuOTgzNCAxMS4zNjU4QzMwLjMwNTggMTIuMTI5NyAzMC41NDE0IDEyLjkxNTEgMzAuNjg4NyAxMy43MDE4QzI5LjA3MjMgMTUuNDQgMjcuNDE3MSAxNy4xNDMyIDI1Ljc0OTUgMTguODMwM0MyMy43OTYyIDIwLjc2NjMgMjEuODE3MSAyMi42ODIyIDE5Ljc4ODcgMjQuNTQ1MUMxNi45MDA4IDI3LjIwMDEgMTMuOTEyMSAyOS43NDQ3IDEwLjc1MDQgMzIuMDg3OEMxMi44NzE5IDI5LjIyMzkgMTUuMTYwMyAyNi41MDIzIDE3LjU0NzEgMjMuODY5NUMxOS42NDE1IDIxLjU1MzEgMjEuODExNCAxOS4zMDQ4IDI0LjAwNzkgMTcuMDg4N0MyNS45NjczIDE1LjE1MTEgMjcuOTUwMSAxMy4yMzE0IDI5Ljk4MzQgMTEuMzY1OFpNMjkuNjk3MSAyMC4zMDRDMzAuNDgxMiAxOC45MTkgMzAuODcxNyAxNy4zNDIgMzAuODc3MSAxNS43MTQ4QzMwLjY0MjYgMTUuOTQyNyAzMC40MDkzIDE2LjE3MTcgMzAuMTc3OSAxNi40MDA4QzI3LjU1OTQgMTkuMDMwMiAyNS4wMzc1IDIxLjc2NzcgMjIuNzM3NCAyNC42OTI2QzIyLjI5NjggMjUuMjUyOSAyMS44NjQ4IDI1LjgxOTkgMjEuNDQwNSAyNi4zOTQ1QzIxLjA2MzkgMjYuOTEwNCAyMC42OTQ5IDI3LjQzMTggMjAuMzQ1NSAyNy45NzQ5QzIwLjg4ODYgMjcuNjI1NiAyMS40MTEgMjcuMjU1NSAyMS45MjU5IDI2Ljg4QzIzLjE4NTUgMjUuOTUxMyAyNC40MDk3IDI0Ljk3OTcgMjUuNjAzMSAyMy45NzM1QzI3LjAwNjEgMjIuNzkyNSAyOC4zNjc0IDIxLjU2NCAyOS42OTcxIDIwLjMwNFoiIGZpbGw9InVybCgjbSkiLz4KICA8L2c+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Im0iIHgxPSIyNSIgeTE9IjcwIiB4Mj0iNjEiIHkyPSIyNyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBzdG9wLWNvbG9yPSIjRkYyMTg5Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0ZGOUQwMCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+Cjwvc3ZnPgo=' width='40' height='40' /><br/>DAMM v2"]
  end

  subgraph Div["DivStrip"]
    DS[divstrip<br/>register + init vault]
    BR[curve-YT vault<br/>holds curve-YT · mints lcYT]
    SW[swap strip YT ↔ curve-YT]
  end

  subgraph Yield["Vault yield park"]
    K["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJLYW1pbm8iPgogIDxyZWN0IHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgcng9IjE0IiBmaWxsPSIjMEEwRjFDIi8+CiAgPHBhdGggZmlsbD0iI0M5RjMxRCIgZD0iTTE2IDE0aDEwdjE1LjJMNDAuNCAxNEg1MkwzNC44IDMyIDUyIDUwSDQwLjRMMjYgMzQuOFY1MEgxNlYxNHoiLz4KPC9zdmc+Cg==' width='40' height='40' /><br/>Kamino cUSDC"]
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
