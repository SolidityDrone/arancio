/**
 * Demo architecture copy — shared by landing diagrams and README narrative.
 * Keep English; mirror in README Mermaid labels.
 */

export type ArchNode = {
  id: string;
  label: string;
  detail: string;
  kind: "oracle" | "program" | "account" | "token" | "venue" | "backend" | "actor";
};

export type ArchStep = {
  id: string;
  t: string;
  title: string;
  body: string;
  nodes: string[];
};

/** Split path: corporate actions → PT/YT → redeem */
export const SPLIT_NODES: ArchNode[] = [
  {
    id: "cre",
    label: "Chainlink CRE",
    detail: "xStocks CA calendar → typed events",
    kind: "oracle",
  },
  {
    id: "registry",
    label: "ca_registry",
    detail: "kind · cum_y · yield_nonce tip",
    kind: "program",
  },
  {
    id: "market",
    label: "StripMarket PDA",
    detail: "per underlying xStock mint",
    kind: "account",
  },
  {
    id: "series",
    label: "StripSeries PDA",
    detail: "one series per yield nonce n",
    kind: "account",
  },
  {
    id: "pt",
    label: "strip PT",
    detail: "capital leg mint",
    kind: "token",
  },
  {
    id: "yt",
    label: "strip YT",
    detail: "yield leg mint (≠ curve-YT)",
    kind: "token",
  },
  {
    id: "vault",
    label: "xStock vault",
    detail: "escrow until redeem / unwrap",
    kind: "account",
  },
];

export const SPLIT_STEPS: ArchStep[] = [
  {
    id: "oracle",
    t: "t₀",
    title: "Oracle writes the calendar",
    body: "CRE labels each corporate action (dividend vs split) and syncs ca_registry. Only yield events advance current_yield_nonce and cum_y.",
    nodes: ["cre", "registry"],
  },
  {
    id: "init",
    t: "t₁",
    title: "Open market + series",
    body: "initialize_strip creates the market PDA for an xStock. create_series opens the strip for yield nonce n (forward or tip).",
    nodes: ["market", "series"],
  },
  {
    id: "wrap",
    t: "t₂",
    title: "Split (wrap)",
    body: "User deposits xStock. DivStrip locks it in the vault and mints strip PT + strip YT 1:1 for that series.",
    nodes: ["vault", "pt", "yt"],
  },
  {
    id: "trade",
    t: "t₃",
    title: "Trade the legs",
    body: "Holders can sell PT (equity without coupon) or YT (next dividends) — separate risk books, same frozen window.",
    nodes: ["pt", "yt"],
  },
  {
    id: "mature",
    t: "t₄",
    title: "Maturity",
    body: "When tip passes nonce n (mature at n+1), legs redeem against frozen Yₛ/Yₜ from the registry — not live multipliers.",
    nodes: ["registry", "pt", "yt", "vault"],
  },
  {
    id: "redeem",
    t: "t₅",
    title: "Redeem capital / yield",
    body: "redeem_capital pays Yₛ/Yₜ of underlying; redeem_yield pays 1 − Yₛ/Yₜ. Early exit uses unwrap before maturity.",
    nodes: ["vault", "pt", "yt"],
  },
];

/** Curve path: DBC → vault → graduation → optional Kamino park */
export const CURVE_NODES: ArchNode[] = [
  {
    id: "user",
    label: "Trader / bonder",
    detail: "Pays USDC on the desk",
    kind: "actor",
  },
  {
    id: "api",
    label: "Launch backend",
    detail: "Next launch-service · Meteora txs",
    kind: "backend",
  },
  {
    id: "dbc",
    label: "Meteora DBC",
    detail: "USDC ↔ curve-YT bonding",
    kind: "venue",
  },
  {
    id: "curve",
    label: "curve-YT mint",
    detail: "Pool discovery token",
    kind: "token",
  },
  {
    id: "divstrip",
    label: "divstrip",
    detail: "register_curve_launch · vault",
    kind: "program",
  },
  {
    id: "bridge",
    label: "curve-YT vault",
    detail: "lcYT shares · NAV bridge",
    kind: "account",
  },
  {
    id: "damm",
    label: "DAMM v2",
    detail: "Post-graduation AMM",
    kind: "venue",
  },
  {
    id: "kamino",
    label: "Kamino cUSDC",
    detail: "Vault parks idle USDC",
    kind: "venue",
  },
];

export const CURVE_STEPS: ArchStep[] = [
  {
    id: "launch",
    t: "01",
    title: "Launch curve-YT pool",
    body: "Backend creates the Meteora DBC config + pool (USDC quote), then DivStrip register_curve_launch and init_curve_bridge (vault).",
    nodes: ["api", "dbc", "curve", "divstrip", "bridge"],
  },
  {
    id: "bond",
    t: "02",
    title: "Bond — buy via vault",
    body: "User pays USDC. Desk swaps on DBC for curve-YT and deposits into the vault; user receives lcYT shares (NAV). No user-side Kamino wrap.",
    nodes: ["user", "dbc", "curve", "bridge"],
  },
  {
    id: "fill",
    t: "03",
    title: "Curve fills",
    body: "Quote reserve climbs toward migration mcap. Bonders hold lcYT; splitters can later swap strip YT ↔ curve-YT through the vault.",
    nodes: ["dbc", "bridge"],
  },
  {
    id: "grad",
    t: "04",
    title: "Graduation",
    body: "At migration threshold, DBC stops. Liquidity moves to DAMM v2 — still curve-YT vs USDC. This clock is independent of strip maturity.",
    nodes: ["dbc", "damm", "curve"],
  },
  {
    id: "park",
    t: "05",
    title: "Vault yield park",
    body: "After fill / graduation, idle vault USDC can be parked in Kamino cUSDC. Users keep buying and exiting in USDC on the desk.",
    nodes: ["bridge", "kamino"],
  },
];

export const SPLIT_SUMMARY =
  "DivStrip turns an xStock into strip PT + strip YT for one yield nonce. Chainlink CRE keeps ca_registry honest so coupons freeze correctly.";

export const CURVE_SUMMARY =
  "curve-YT discovers the forward coupon in USDC on Meteora before anyone splits. The DivStrip vault bridges bonders (lcYT) and splitters; graduation and maturity are different clocks.";
