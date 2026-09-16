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

/** Compact spot price for market list rows. */
export function formatStockPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 100) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

export async function fetchPricesUsd(
  symbols: string[]
): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    symbols.map(async (symbol) => [symbol, await fetchPriceUsd(symbol)] as const)
  );
  return Object.fromEntries(entries);
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
