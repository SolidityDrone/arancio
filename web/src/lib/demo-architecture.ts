/**
 * Architecture diagrams for the landing page. Coordinates mirror
 * scripts/render-diagrams.py so the README SVGs and the animated home match.
 * Arrows only run through empty corridors between blocks.
 */

export type EdgeColor = "purple" | "green" | "magenta" | "lime";

export type IsoPlate = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
};

export type IsoBlock = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  logo?: string;
};

export type IsoEdge = {
  id: string;
  points: [number, number][];
  color: EdgeColor;
  dashed?: boolean;
  /** Bus / junction segments have no arrowhead. */
  noHead?: boolean;
  label?: { x: number; y: number; text: string };
};

export type IsoStep = {
  id: string;
  t: string;
  title: string;
  body: string;
  blocks: string[];
  edges: string[];
};

export type IsoDiagramSpec = {
  id: string;
  width: number;
  height: number;
  eyebrow: string;
  title: string;
  lead: string;
  footer: { y: number; text: string };
  plates: IsoPlate[];
  blocks: IsoBlock[];
  edges: IsoEdge[];
  steps: IsoStep[];
};

export const ISO_DEPTH = 14;

const GREEN = "#14F195";
const PURPLE = "#9945FF";
const CYAN = "#00C2FF";
const ORANGE = "#FF7A3D";
const LIME = "#C9F31D";

const KID_X = [60, 266, 472, 678, 884];
const KID_CX = KID_X.map((x) => x + 88);
const BUS_Y = 398;

export const SPLIT_DIAGRAM: IsoDiagramSpec = {
  id: "split",
  width: 1130,
  height: 610,
  eyebrow: "Diagram 01 · On-chain split",
  title: "From the xStocks calendar to PT / YT",
  lead: "Chainlink CRE reads the xStocks API and writes ca_registry. DivStrip locks xStock and mints strip PT + strip YT for one yield nonce.",
  footer: {
    y: 582,
    text: "After maturity: PT redeems Yₛ/Yₜ of the underlying · YT redeems 1 − Yₛ/Yₜ",
  },
  plates: [
    { x: 40, y: 88, w: 1050, h: 120, label: "OFF-CHAIN", color: CYAN },
    { x: 40, y: 236, w: 1050, h: 296, label: "ON-CHAIN · SOLANA", color: GREEN },
  ],
  blocks: [
    { id: "xstocks", x: 200, y: 122, w: 200, h: 70, title: "xStocks API", sub: "CA calendar", logo: "/brand/xstocks.svg" },
    { id: "cre", x: 520, y: 122, w: 200, h: 70, title: "Chainlink CRE", sub: "yield vs supply", logo: "/brand/chainlink.svg" },
    { id: "registry", x: 520, y: 280, w: 200, h: 70, title: "ca_registry", sub: "tip · cum_y · nonce" },
    { id: "divstrip", x: 840, y: 280, w: 200, h: 70, title: "divstrip", sub: "wrap / redeem" },
    { id: "market", x: KID_X[0], y: 440, w: 176, h: 64, title: "StripMarket", sub: "per xStock mint" },
    { id: "series", x: KID_X[1], y: 440, w: 176, h: 64, title: "StripSeries n", sub: "one yield window" },
    { id: "vault", x: KID_X[2], y: 440, w: 176, h: 64, title: "xStock vault", sub: "escrow until redeem" },
    { id: "pt", x: KID_X[3], y: 440, w: 176, h: 64, title: "strip PT", sub: "capital leg" },
    { id: "yt", x: KID_X[4], y: 440, w: 176, h: 64, title: "strip YT", sub: "yield leg" },
  ],
  edges: [
    { id: "xs-cre", points: [[418, 157], [516, 157]], color: "purple", label: { x: 467, y: 139, text: "CA calendar" } },
    { id: "cre-reg", points: [[620, 196], [620, 262]], color: "purple", label: { x: 696, y: 222, text: "typed CA events" } },
    { id: "reg-div", points: [[738, 315], [836, 315]], color: "green", label: { x: 787, y: 297, text: "nonce · cum_y" } },
    { id: "div-bus", points: [[940, 354], [940, BUS_Y]], color: "green", noHead: true, label: { x: 1004, y: 368, text: "wrap · mint 1:1" } },
    { id: "bus", points: [[KID_CX[0], BUS_Y], [KID_CX[4], BUS_Y]], color: "green", noHead: true },
    { id: "to-market", points: [[KID_CX[0], BUS_Y], [KID_CX[0], 422]], color: "green" },
    { id: "to-series", points: [[KID_CX[1], BUS_Y], [KID_CX[1], 422]], color: "green" },
    { id: "to-vault", points: [[KID_CX[2], BUS_Y], [KID_CX[2], 422]], color: "green" },
    { id: "to-pt", points: [[KID_CX[3], BUS_Y], [KID_CX[3], 422]], color: "green" },
    { id: "to-yt", points: [[KID_CX[4], BUS_Y], [KID_CX[4], 422]], color: "green" },
  ],
  steps: [
    {
      id: "oracle",
      t: "t₀",
      title: "Oracle writes the calendar",
      body: "Chainlink CRE pulls corporate actions from the xStocks API, labels each one (dividend vs split) and syncs ca_registry. Only yield events advance the nonce and cum_y.",
      blocks: ["xstocks", "cre", "registry"],
      edges: ["xs-cre", "cre-reg"],
    },
    {
      id: "open",
      t: "t₁",
      title: "Open market + series",
      body: "divstrip reads the registry tip, creates the StripMarket PDA for the xStock and a StripSeries for yield nonce n.",
      blocks: ["registry", "divstrip", "market", "series"],
      edges: ["reg-div", "div-bus", "bus", "to-market", "to-series"],
    },
    {
      id: "wrap",
      t: "t₂",
      title: "Split (wrap)",
      body: "The trader deposits xStock. It is locked in the vault and strip PT + strip YT are minted 1:1 for that series.",
      blocks: ["divstrip", "vault", "pt", "yt"],
      edges: ["div-bus", "bus", "to-vault", "to-pt", "to-yt"],
    },
    {
      id: "redeem",
      t: "t₃",
      title: "Maturity & redeem",
      body: "When the tip passes n, the coupon freezes from ca_registry. PT redeems Yₛ/Yₜ of the underlying, YT redeems 1 − Yₛ/Yₜ.",
      blocks: ["registry", "divstrip", "vault", "pt", "yt"],
      edges: ["reg-div", "div-bus", "bus", "to-vault", "to-pt", "to-yt"],
    },
  ],
};

const C1 = 70;
const C2 = 475;
const C3 = 880;
const R1 = 170;
const R2 = 350;
const R3 = 550;

export const CURVE_DIAGRAM: IsoDiagramSpec = {
  id: "curve",
  width: 1180,
  height: 700,
  eyebrow: "Diagram 02 · Curve market",
  title: "DBC bonding, vault shares, graduation",
  lead: "Traders swap USDC for curve-YT on Meteora, then deposit it into the DivStrip vault for lcYT. Graduation and strip maturity run on different clocks.",
  footer: {
    y: 680,
    text: "The vault never pulls curve-YT from Meteora — the trader wallet is the hop (② → ③).",
  },
  plates: [
    { x: 46, y: 108, w: 292, h: 542, label: "METEORA", color: ORANGE },
    { x: 451, y: 108, w: 292, h: 330, label: "DESK", color: PURPLE },
    { x: 856, y: 108, w: 292, h: 330, label: "DIVSTRIP", color: GREEN },
    { x: 856, y: 482, w: 292, h: 168, label: "YIELD", color: LIME },
  ],
  blocks: [
    { id: "api", x: C2, y: R1, w: 230, h: 76, title: "Launch backend", sub: "Meteora txs · register", logo: "/brand/server.svg" },
    { id: "divstrip", x: C3, y: R1, w: 230, h: 76, title: "divstrip", sub: "register_curve_launch" },
    { id: "dbc", x: C1, y: R2, w: 230, h: 76, title: "DBC bonding", sub: "USDC ↔ curve-YT", logo: "/brand/meteora.svg" },
    { id: "trader", x: C2, y: R2, w: 230, h: 76, title: "Trader wallet", sub: "pays USDC · holds hops" },
    { id: "vault", x: C3, y: R2, w: 230, h: 76, title: "curve-YT vault", sub: "holds curve-YT · lcYT" },
    { id: "damm", x: C1, y: R3, w: 230, h: 76, title: "DAMM v2", sub: "post-graduation AMM", logo: "/brand/meteora.svg" },
    { id: "kamino", x: C3, y: R3, w: 230, h: 76, title: "Kamino cUSDC", sub: "vault-side USDC park", logo: "/brand/kamino.svg" },
  ],
  edges: [
    { id: "register", points: [[723, 208], [876, 208]], color: "purple", label: { x: 799.5, y: 188, text: "register · init vault" } },
    { id: "create-pool", points: [[471, 208], [185, 208], [185, 332]], color: "purple", label: { x: 265, y: 188, text: "create pool" } },
    { id: "vault-pda", points: [[995, 250], [995, 332]], color: "purple", label: { x: 1053, y: 291, text: "vault PDA" } },
    { id: "usdc", points: [[471, 372], [318, 372]], color: "green", label: { x: 394.5, y: 354, text: "① USDC" } },
    { id: "curve", points: [[318, 406], [471, 406]], color: "green", label: { x: 394.5, y: 426, text: "② curve-YT" } },
    { id: "deposit", points: [[723, 372], [876, 372]], color: "green", label: { x: 799.5, y: 354, text: "③ deposit curve-YT" } },
    { id: "lcyt", points: [[876, 406], [723, 406]], color: "green", label: { x: 799.5, y: 426, text: "④ mint lcYT" } },
    { id: "graduate", points: [[185, 430], [185, 532]], color: "magenta", label: { x: 241, y: 456, text: "graduate" } },
    { id: "park", points: [[995, 430], [995, 532]], color: "lime", dashed: true, label: { x: 1069, y: 456, text: "park idle USDC" } },
  ],
  steps: [
    {
      id: "launch",
      t: "01",
      title: "Launch the curve-YT pool",
      body: "The launch backend creates the Meteora DBC config + pool (USDC quote), then calls register_curve_launch and init_curve_bridge on divstrip.",
      blocks: ["api", "dbc", "divstrip", "vault"],
      edges: ["create-pool", "register", "vault-pda"],
    },
    {
      id: "buy",
      t: "02",
      title: "Buy curve-YT",
      body: "The trader pays USDC into the DBC curve (①) and receives curve-YT in their wallet (②).",
      blocks: ["trader", "dbc"],
      edges: ["usdc", "curve"],
    },
    {
      id: "deposit",
      t: "03",
      title: "Deposit for lcYT",
      body: "The wallet deposits curve-YT into the DivStrip vault (③) and receives lcYT shares at NAV (④).",
      blocks: ["trader", "vault"],
      edges: ["deposit", "lcyt"],
    },
    {
      id: "graduate",
      t: "04",
      title: "Graduation",
      body: "When the quote reserve hits the migration mcap, DBC stops and liquidity moves to DAMM v2 — still curve-YT vs USDC.",
      blocks: ["dbc", "damm"],
      edges: ["graduate"],
    },
    {
      id: "park",
      t: "05",
      title: "Vault yield park",
      body: "Idle vault USDC can be parked in Kamino cUSDC. Traders keep entering and exiting in plain USDC.",
      blocks: ["vault", "kamino"],
      edges: ["park"],
    },
  ],
};

export const ARCH_DIAGRAMS = [SPLIT_DIAGRAM, CURVE_DIAGRAM];
