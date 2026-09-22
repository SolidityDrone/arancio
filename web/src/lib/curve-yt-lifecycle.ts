/** Product lifecycle: curve-YT (Meteora) vs strip YT (DivStrip). */

export type LifecyclePhase = {
  id: string;
  step: string;
  title: string;
  venue: string;
  pair: string;
  body: string;
  status: "live" | "roadmap";
};

export const CURVE_YT_LIFECYCLE: LifecyclePhase[] = [
  {
    id: "discover",
    step: "01",
    title: "Price discovery",
    venue: "Meteora DBC",
    pair: "USDC ↔ curve-YT",
    body:
      "Launch a curve-YT pool for a single yield nonce n. Traders pay USDC to buy curve-YT before anyone splits xStock. No LP seed required — the bonding curve discovers a forward yield price.",
    status: "live",
  },
  {
    id: "graduate",
    step: "02",
    title: "Bonding ends (graduation)",
    venue: "Meteora DAMM v2",
    pair: "USDC ↔ curve-YT",
    body:
      "When enough USDC fills the curve, DBC stops and liquidity graduates to a normal AMM. This is still curve-YT — not strip YT. Graduation and nonce maturity are different clocks.",
    status: "live",
  },
  {
    id: "split",
    step: "03",
    title: "Split (real legs)",
    venue: "DivStrip",
    pair: "xStock → strip PT + strip YT",
    body:
      "Deposit xStock to mint strip PT and strip YT 1:1 for the same yield nonce. These are on-chain DivStrip tokens — separate mints from curve-YT.",
    status: "live",
  },
  {
    id: "exit",
    step: "04",
    title: "Strip exit (DAMM spot)",
    venue: "DivStrip curve-YT vault",
    pair: "strip YT → curve-YT → USDC",
    body:
      "After split, swap strip YT for curve-YT from the vault at the current DBC/DAMM spot (adjusted by fair coupon vs launch). Sell curve-YT on Meteora — that pulls USDC from the pool bonders filled.",
    status: "live",
  },
  {
    id: "mature",
    step: "05",
    title: "Maturity",
    venue: "DivStrip",
    pair: "strip PT / strip YT → xStock",
    body:
      "When tip passes nonce n (mature at n+1), redeem strip legs for underlying per frozen coupon from ca_registry. curve-YT may wind down or convert via the vault — maturity is a strip event, not a Meteora event.",
    status: "live",
  },
  {
    id: "deep",
    step: "06",
    title: "Deep liquidity (optional)",
    venue: "AMM / DLMM",
    pair: "USDC ↔ strip YT",
    body:
      "Once enough strip YT circulates, LPs can pool the real yield leg against USDC. curve-YT discovery sets the reference price before this market exists.",
    status: "roadmap",
  },
];

export const LIFECYCLE_SUMMARY =
  "curve-YT prices each yield nonce in USDC before splits. strip YT is the real yield leg after split. The curve-YT vault connects them.";
