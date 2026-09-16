/** xStocks public API helpers for the strip desk */

const API = "https://api.xstocks.fi/api/v2/public";

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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`xStocks API ${res.status}: ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchAsset(symbol: string): Promise<XStockAsset> {
  return getJson(`${API}/assets/${encodeURIComponent(symbol)}`);
}

export async function fetchPriceUsd(symbol: string): Promise<number | null> {
  try {
    const data = await getJson<{ quote?: number }>(
      `${API}/assets/${encodeURIComponent(symbol)}/price-data`
    );
    return typeof data.quote === "number" ? data.quote : null;
  } catch {
    return null;
  }
}

export async function fetchCirculatingSupply(
  symbol: string
): Promise<number | null> {
  try {
    const data = await getJson<{ value?: number }>(
      `${API}/assets/${encodeURIComponent(symbol)}/circulating-supply`
    );
    return typeof data.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

export async function fetchTotalSupply(symbol: string): Promise<number | null> {
  try {
    const data = await getJson<{ value?: number }>(
      `${API}/assets/${encodeURIComponent(symbol)}/total-supply`
    );
    return typeof data.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

export async function fetchCaHistory(
  symbol: string
): Promise<CorporateAction[]> {
  try {
    const data = await getJson<{ nodes?: CorporateAction[] }>(
      `${API}/corporate-actions/history?symbol=${encodeURIComponent(symbol)}&network=Solana&pageSize=50`
    );
    return data.nodes ?? [];
  } catch {
    return [];
  }
}

export async function fetchCaUpcoming(
  symbol: string
): Promise<CorporateAction[]> {
  try {
    const data = await getJson<{ nodes?: CorporateAction[] }>(
      `${API}/corporate-actions/upcoming?symbol=${encodeURIComponent(symbol)}&network=Solana&pageSize=50`
    );
    return data.nodes ?? [];
  } catch {
    return [];
  }
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

export type MarketIntel = {
  asset: XStockAsset | null;
  priceUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  mcapUsd: number | null;
  history: CorporateAction[];
  upcoming: CorporateAction[];
  yieldEvents: CorporateAction[];
};

export async function fetchMarketIntel(symbol: string): Promise<MarketIntel> {
  const [asset, priceUsd, circulatingSupply, totalSupply, history, upcoming] =
    await Promise.all([
      fetchAsset(symbol).catch(() => null),
      fetchPriceUsd(symbol),
      fetchCirculatingSupply(symbol),
      fetchTotalSupply(symbol),
      fetchCaHistory(symbol),
      fetchCaUpcoming(symbol),
    ]);

  const yieldEvents = history.filter(
    (e) =>
      (e.caType === "CashDividend" || e.caType === "StockDividend") &&
      e.multiplierOld &&
      e.multiplierNew
  );

  const mcapUsd =
    priceUsd != null && circulatingSupply != null
      ? priceUsd * circulatingSupply
      : null;

  return {
    asset,
    priceUsd,
    circulatingSupply,
    totalSupply,
    mcapUsd,
    history,
    upcoming,
    yieldEvents,
  };
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
