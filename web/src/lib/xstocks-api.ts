/** xStocks public API helpers for the strip desk */

import { MARKETS } from "./markets";

const UPSTREAM_API = "https://api.xstocks.fi/api/v2/public";
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

const MINT_BY_SYMBOL = Object.fromEntries(
  MARKETS.map((m) => [m.symbol, m.mint])
) as Record<string, string>;

/** Browser calls go through Next proxy (xStocks has no CORS). Server uses upstream. */
function apiBase(): string {
  if (typeof window === "undefined") return UPSTREAM_API;
  return "/api/xstocks";
}

export type XStockAsset = {
  symbol: string;
  name: string;
  description?: string;
  logo?: string;
  underlyingSymbol?: string;
  isTradingHalted?: boolean;
  trading?: {
    openNow?: boolean;
    exchange?: string;
    currency?: string;
  };
};

export type CorporateAction = {
  eventId: string;
  caType: string;
  effectiveTimeUtc: string;
  multiplierOld?: string | null;
  multiplierNew?: string | null;
  grossCashflowUsd?: string | null;
  netCashflowUsd?: string | null;
  withholdingTaxRate?: string | null;
  status?: string;
};

export function caEffectiveDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}

/** Stable key for list rows + nonce lookup. */
export function caRowKey(action: CorporateAction): string {
  if (action.eventId) return action.eventId;
  return `${action.caType}:${caEffectiveDay(action.effectiveTimeUtc)}`;
}

function hasMultipliers(action: CorporateAction): boolean {
  return Boolean(action.multiplierOld && action.multiplierNew);
}

/** Same economic CA across history/upcoming (shared id or ~same ex-date). */
export function isSameCorporateAction(
  a: CorporateAction,
  b: CorporateAction
): boolean {
  if (a.eventId && b.eventId && a.eventId === b.eventId) return true;
  if (a.caType !== b.caType) return false;
  const ta = new Date(a.effectiveTimeUtc).getTime();
  const tb = new Date(b.effectiveTimeUtc).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return caEffectiveDay(a.effectiveTimeUtc) === caEffectiveDay(b.effectiveTimeUtc);
  }
  if (caEffectiveDay(a.effectiveTimeUtc) === caEffectiveDay(b.effectiveTimeUtc)) {
    return true;
  }
  // History vs upcoming often differ by a few hours around midnight UTC.
  return Math.abs(ta - tb) <= 36 * 60 * 60 * 1000;
}

function preferCaRecord(
  left: CorporateAction,
  right: CorporateAction
): CorporateAction {
  const leftMult = hasMultipliers(left);
  const rightMult = hasMultipliers(right);
  if (leftMult && !rightMult) return left;
  if (rightMult && !leftMult) return right;
  return left;
}

function dedupeCaList(actions: CorporateAction[]): CorporateAction[] {
  const out: CorporateAction[] = [];
  for (const action of actions) {
    const idx = out.findIndex((existing) => isSameCorporateAction(existing, action));
    if (idx < 0) {
      out.push(action);
      continue;
    }
    out[idx] = preferCaRecord(out[idx], action);
  }
  return out;
}

/** xStocks often returns the same CA in both history and upcoming — keep one row. */
export function mergeCorporateActions(
  history: CorporateAction[],
  upcoming: CorporateAction[]
): CorporateAction[] {
  return dedupeCaList([...history, ...upcoming]);
}

export type CaListRow = CorporateAction & { upcoming: boolean };

/** Sidebar list: upcoming-only first, then history — no duplicates. */
export function buildCaListRows(
  history: CorporateAction[],
  upcoming: CorporateAction[]
): CaListRow[] {
  const historyDeduped = dedupeCaList(history);
  const upcomingOnly = dedupeCaList(upcoming)
    .filter(
      (row) => !historyDeduped.some((h) => isSameCorporateAction(h, row))
    )
    .sort(
      (a, b) =>
        new Date(a.effectiveTimeUtc).getTime() -
        new Date(b.effectiveTimeUtc).getTime()
    )
    .map((row) => ({ ...row, upcoming: true as const }));

  const historyRows = historyDeduped
    .sort(
      (a, b) =>
        new Date(b.effectiveTimeUtc).getTime() -
        new Date(a.effectiveTimeUtc).getTime()
    )
    .map((row) => ({ ...row, upcoming: false as const }));

  return [...upcomingOnly, ...historyRows];
}

async function getJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs != null ? new AbortController() : null;
  const timer =
    controller != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller?.signal,
    });
    if (!res.ok) {
      throw new Error(`xStocks API ${res.status}: ${url}`);
    }
    return res.json() as Promise<T>;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

/** xStocks price-data can hang ~20s when the equity market is closed. */
const XSTOCKS_PRICE_TIMEOUT_MS = 2_500;

export async function fetchAsset(symbol: string): Promise<XStockAsset> {
  return getJson(`${apiBase()}/assets/${encodeURIComponent(symbol)}`);
}

type DexScreenerPair = {
  baseToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
};

function bestDexScreenerPrice(
  mint: string,
  pairs: DexScreenerPair[]
): number | null {
  const mintLower = mint.toLowerCase();
  const best = pairs
    .filter((p) => p.baseToken?.address?.toLowerCase() === mintLower)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const n = best?.priceUsd != null ? Number(best.priceUsd) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** On-chain DEX quote when xStocks indicative price is null (market closed). */
async function fetchDexScreenerPriceByMint(
  mint: string
): Promise<number | null> {
  try {
    const data = await getJson<{ pairs?: DexScreenerPair[] }>(
      `${DEXSCREENER_API}/${mint}`
    );
    return bestDexScreenerPrice(mint, data.pairs ?? []);
  } catch {
    return null;
  }
}

async function fetchDexScreenerPricesByMint(
  mints: string[]
): Promise<Record<string, number | null>> {
  const unique = [...new Set(mints)];
  if (unique.length === 0) return {};
  const entries = await Promise.all(
    unique.map(
      async (mint) =>
        [mint, await fetchDexScreenerPriceByMint(mint)] as const
    )
  );
  return Object.fromEntries(entries);
}

async function fetchXstocksQuoteUsd(symbol: string): Promise<number | null> {
  try {
    const data = await getJson<{ quote?: number | null }>(
      `${apiBase()}/assets/${encodeURIComponent(symbol)}/price-data`,
      XSTOCKS_PRICE_TIMEOUT_MS
    );
    return typeof data.quote === "number" ? data.quote : null;
  } catch {
    return null;
  }
}

export async function fetchPriceUsd(symbol: string): Promise<number | null> {
  const mint = MINT_BY_SYMBOL[symbol];
  const [quote, dex] = await Promise.all([
    fetchXstocksQuoteUsd(symbol),
    mint ? fetchDexScreenerPricesByMint([mint]) : Promise.resolve({}),
  ]);
  if (quote != null) return quote;
  return mint ? (dex[mint] ?? null) : null;
}

export async function fetchCirculatingSupply(
  symbol: string
): Promise<number | null> {
  try {
    const data = await getJson<{ value?: number }>(
      `${apiBase()}/assets/${encodeURIComponent(symbol)}/circulating-supply`
    );
    return typeof data.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

export async function fetchTotalSupply(symbol: string): Promise<number | null> {
  try {
    const data = await getJson<{ value?: number }>(
      `${apiBase()}/assets/${encodeURIComponent(symbol)}/total-supply`
    );
    return typeof data.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

export async function fetchCaHistory(
  symbol: string
): Promise<CorporateAction[]> {
  const data = await getJson<{ nodes?: CorporateAction[] }>(
    `${apiBase()}/corporate-actions/history?symbol=${encodeURIComponent(symbol)}&network=Solana&pageSize=50`
  );
  return data.nodes ?? [];
}

export async function fetchCaUpcoming(
  symbol: string
): Promise<CorporateAction[]> {
  const data = await getJson<{ nodes?: CorporateAction[] }>(
    `${apiBase()}/corporate-actions/upcoming?symbol=${encodeURIComponent(symbol)}&network=Solana&pageSize=50`
  );
  return data.nodes ?? [];
}

/** Mean gross cash dividend (USD per share) from recent history. */
export function avgCashDistributionUsd(
  history: CorporateAction[],
  lookback = 8
): number | null {
  const cash = history
    .filter((e) => e.caType === "CashDividend" && e.grossCashflowUsd)
    .sort(
      (a, b) =>
        new Date(b.effectiveTimeUtc).getTime() -
        new Date(a.effectiveTimeUtc).getTime()
    )
    .slice(0, lookback);
  if (cash.length === 0) return null;
  const sum = cash.reduce((acc, e) => acc + Number(e.grossCashflowUsd), 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return sum / cash.length;
}

/** Rough trailing dividend yield from recent CashDividend cashflows vs spot. */
export function trailingDivYield(
  history: CorporateAction[],
  priceUsd: number | null,
  lookback = 4
): number | null {
  if (!priceUsd || priceUsd <= 0) return null;
  const cash = history
    .filter((e) => e.caType === "CashDividend" && e.grossCashflowUsd)
    .sort(
      (a, b) =>
        new Date(b.effectiveTimeUtc).getTime() -
        new Date(a.effectiveTimeUtc).getTime()
    )
    .slice(0, lookback);
  if (cash.length === 0) return null;
  const sum = cash.reduce((acc, e) => acc + Number(e.grossCashflowUsd), 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  // assume ~quarterly cadence → annualize by 4 / lookback used
  const annualized = sum * (4 / cash.length);
  return annualized / priceUsd;
}

export type MarketQuotes = {
  asset: XStockAsset | null;
  priceUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  mcapUsd: number | null;
};

export type CorporateActionsIntel = {
  history: CorporateAction[];
  upcoming: CorporateAction[];
  yieldEvents: CorporateAction[];
};

export type MarketIntel = MarketQuotes & CorporateActionsIntel;

function yieldEventsFromHistory(
  history: CorporateAction[]
): CorporateAction[] {
  return history.filter(
    (e) =>
      (e.caType === "CashDividend" || e.caType === "StockDividend") &&
      e.multiplierOld &&
      e.multiplierNew
  );
}

export async function fetchCorporateActions(
  symbol: string
): Promise<CorporateActionsIntel> {
  const [history, upcoming] = await Promise.all([
    fetchCaHistory(symbol),
    fetchCaUpcoming(symbol),
  ]);
  return {
    history,
    upcoming,
    yieldEvents: yieldEventsFromHistory(history),
  };
}

export async function fetchMarketQuotes(symbol: string): Promise<MarketQuotes> {
  const [asset, priceUsd, circulatingSupply, totalSupply] = await Promise.all([
    fetchAsset(symbol).catch(() => null),
    fetchPriceUsd(symbol),
    fetchCirculatingSupply(symbol),
    fetchTotalSupply(symbol),
  ]);
  const mcapUsd =
    priceUsd != null && circulatingSupply != null
      ? priceUsd * circulatingSupply
      : null;
  return { asset, priceUsd, circulatingSupply, totalSupply, mcapUsd };
}

/** Fast CA sidebar — xStocks history/upcoming only (~300ms). */
export async function fetchCorporateActionsForDesk(
  symbol: string
): Promise<CorporateActionsIntel> {
  if (typeof window === "undefined") {
    return fetchCorporateActions(symbol);
  }
  const res = await fetch(
    `/api/market-ca?symbol=${encodeURIComponent(symbol)}`,
    { headers: { Accept: "application/json" } }
  );
  const body = (await res.json()) as CorporateActionsIntel & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Market CA HTTP ${res.status}`);
  }
  return body;
}

/** Spot, supply, mcap — may wait on price fallback (~3s when market closed). */
export async function fetchMarketQuotesForDesk(
  symbol: string
): Promise<MarketQuotes> {
  if (typeof window === "undefined") {
    return fetchMarketQuotes(symbol);
  }
  const res = await fetch(
    `/api/market-intel?symbol=${encodeURIComponent(symbol)}`,
    { headers: { Accept: "application/json" } }
  );
  const body = (await res.json()) as MarketQuotes & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Market intel HTTP ${res.status}`);
  }
  return body;
}

/** Desk UI — always via Next API (server fetches xStocks, no browser CORS). */
export async function fetchMarketIntelForDesk(
  symbol: string
): Promise<MarketIntel> {
  if (typeof window === "undefined") {
    return fetchMarketIntel(symbol);
  }
  const [quotes, ca] = await Promise.all([
    fetchMarketQuotesForDesk(symbol),
    fetchCorporateActionsForDesk(symbol),
  ]);
  return { ...quotes, ...ca };
}

export async function fetchMarketIntel(symbol: string): Promise<MarketIntel> {
  const [quotes, ca] = await Promise.all([
    fetchMarketQuotes(symbol),
    fetchCorporateActions(symbol),
  ]);
  return { ...quotes, ...ca };
}

/** Compact spot price for market list rows. */
export function formatStockPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 100) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

export async function fetchPricesUsdForDesk(
  symbols: string[]
): Promise<Record<string, number | null>> {
  if (typeof window === "undefined") {
    return fetchPricesUsd(symbols);
  }
  if (symbols.length === 0) return {};
  const res = await fetch(
    `/api/market-prices?symbols=${encodeURIComponent(symbols.join(","))}`,
    { headers: { Accept: "application/json" } }
  );
  const body = (await res.json()) as Record<string, number | null> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `Market prices HTTP ${res.status}`);
  }
  return body;
}

export async function fetchPricesUsd(
  symbols: string[]
): Promise<Record<string, number | null>> {
  const mints = symbols
    .map((s) => MINT_BY_SYMBOL[s])
    .filter((m): m is string => Boolean(m));

  const [entries, dex] = await Promise.all([
    Promise.all(
      symbols.map(
        async (symbol) =>
          [symbol, await fetchXstocksQuoteUsd(symbol)] as const
      )
    ),
    fetchDexScreenerPricesByMint(mints),
  ]);

  const out = Object.fromEntries(entries) as Record<string, number | null>;
  for (const symbol of symbols) {
    if (out[symbol] != null) continue;
    const mint = MINT_BY_SYMBOL[symbol];
    if (mint && dex[mint] != null) out[symbol] = dex[mint];
  }
  return out;
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
  return `$${n.toFixed(digits)}`;
}

export function formatQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toFixed(4);
}
