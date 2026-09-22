import {
  Connection,
  PublicKey,
  type ParsedAccountData,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  activityYieldNonce,
  loadDeskActivities,
} from "./desk-activity";
import { fetchDbcPoolSnapshot } from "./dbc-pool-desk";
import { MARKETS, type MarketConfig } from "./markets";
import {
  launchYieldNonce,
  loadLaunches,
  type StoredLaunch,
} from "./meteora-dbc";
import {
  loadStripPositions,
  positionYieldNonce,
} from "./strip-positions";
import { formatRawAmount } from "./strip-math";
import {
  marketPda,
  ptMintPda,
  seriesPda,
  ytMintPda,
} from "./strip-tx";

export type SeriesHolding = {
  yieldNonce: number;
  ptAmount: string;
  ytAmount: string;
  ptRaw: bigint;
  ytRaw: bigint;
  seriesExists: boolean;
};

/** @deprecated Use SeriesHolding */
export type WindowHolding = SeriesHolding & {
  startNonce?: number;
  targetNonce?: number;
};

export type DbcPoolRow = {
  launch: StoredLaunch;
  progressPct: number | null;
  isMigrated: boolean;
  phase: string;
};

export type StockPortfolio = {
  market: MarketConfig;
  underlyingUi: string;
  underlyingRaw: bigint;
  decimals: number;
  /** Strip series held (one yield nonce each). */
  windows: SeriesHolding[];
  dbcPools: DbcPoolRow[];
};

const MINT_TO_MARKET = new Map(MARKETS.map((m) => [m.mint, m]));
const PORTFOLIO_TIMEOUT_MS = 45_000;
const DBC_SNAPSHOT_TIMEOUT_MS = 12_000;
/** Scan past tip + forward window so historical PT/YT balances are not capped at 8. */
const MAX_YIELD_NONCE_SCAN = 128;

export type OwnedSchedule = {
  market: MarketConfig;
  yieldNonce: number;
  ptAmount: string;
  ytAmount: string;
  ptRaw: bigint;
  ytRaw: bigint;
  seriesExists: boolean;
};

export function flattenOwnedSchedules(
  portfolio: StockPortfolio[]
): OwnedSchedule[] {
  const out: OwnedSchedule[] = [];
  for (const row of portfolio) {
    for (const window of row.windows) {
      if (window.ptRaw <= 0n && window.ytRaw <= 0n) continue;
      out.push({
        market: row.market,
        yieldNonce: window.yieldNonce,
        ptAmount: window.ptAmount,
        ytAmount: window.ytAmount,
        ptRaw: window.ptRaw,
        ytRaw: window.ytRaw,
        seriesExists: window.seriesExists,
      });
    }
  }
  out.sort((a, b) => {
    const sym = a.market.symbol.localeCompare(b.market.symbol);
    if (sym !== 0) return sym;
    return b.yieldNonce - a.yieldNonce;
  });
  return out;
}

type TokenBalance = { raw: bigint; decimals: number; ui: string };

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function nonceKey(nonce: number): string {
  return String(nonce);
}

function collectYieldNonces(symbol: string): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  const add = (nonce: number) => {
    const key = nonceKey(nonce);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(nonce);
  };

  for (const p of loadStripPositions()) {
    if (p.symbol === symbol) add(positionYieldNonce(p));
  }
  for (const l of loadLaunches()) {
    if (l.symbol === symbol) add(launchYieldNonce(l));
  }
  for (const a of loadDeskActivities()) {
    if (a.symbol === symbol) add(activityYieldNonce(a));
  }
  return out;
}

function discoverYieldNonces(
  market: MarketConfig,
  marketKey: PublicKey,
  splBalances: Map<string, TokenBalance>
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (nonce: number) => {
    if (seen.has(nonce)) return;
    seen.add(nonce);
    out.push(nonce);
  };

  for (const nonce of collectYieldNonces(market.symbol)) {
    add(nonce);
  }

  for (let nonce = 0; nonce <= MAX_YIELD_NONCE_SCAN; nonce++) {
    const ptMint = ptMintPda(marketKey, nonce).toBase58();
    const ytMint = ytMintPda(marketKey, nonce).toBase58();
    const pt = splBalances.get(ptMint);
    const yt = splBalances.get(ytMint);
    if ((pt?.raw ?? 0n) > 0n || (yt?.raw ?? 0n) > 0n) {
      add(nonce);
    }
  }

  return out;
}

function collectRelevantSymbols(
  token2022Balances: Map<string, TokenBalance>,
  splBalances: Map<string, TokenBalance>
): Set<string> {
  const symbols = new Set<string>();

  for (const p of loadStripPositions()) symbols.add(p.symbol);
  for (const l of loadLaunches()) symbols.add(l.symbol);
  for (const a of loadDeskActivities()) symbols.add(a.symbol);

  for (const [mint, balance] of token2022Balances) {
    if (balance.raw <= 0n) continue;
    const market = MINT_TO_MARKET.get(mint);
    if (market) symbols.add(market.symbol);
  }

  for (const market of MARKETS) {
    const marketKey = marketPda(new PublicKey(market.mint));
    for (let nonce = 0; nonce <= MAX_YIELD_NONCE_SCAN; nonce++) {
      const ptMint = ptMintPda(marketKey, nonce).toBase58();
      const ytMint = ytMintPda(marketKey, nonce).toBase58();
      const pt = splBalances.get(ptMint);
      const yt = splBalances.get(ytMint);
      if ((pt?.raw ?? 0n) > 0n || (yt?.raw ?? 0n) > 0n) {
        symbols.add(market.symbol);
        break;
      }
    }
  }

  return symbols;
}

async function fetchTokenBalancesByMint(
  connection: Connection,
  owner: PublicKey,
  programId: PublicKey
): Promise<Map<string, TokenBalance>> {
  const out = new Map<string, TokenBalance>();
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    programId,
  });
  for (const { account } of response.value) {
    const parsed = account.data as ParsedAccountData;
    const info = parsed.parsed.info as {
      mint: string;
      tokenAmount: {
        amount: string;
        decimals: number;
        uiAmountString: string | null;
      };
    };
    out.set(info.mint, {
      raw: BigInt(info.tokenAmount.amount),
      decimals: info.tokenAmount.decimals,
      ui: info.tokenAmount.uiAmountString ?? "0",
    });
  }
  return out;
}

function hasAnyBalance(row: StockPortfolio): boolean {
  return row.windows.some((w) => w.ptRaw > 0n || w.ytRaw > 0n);
}

async function fetchWalletPortfolioInner(
  connection: Connection,
  owner: PublicKey
): Promise<StockPortfolio[]> {
  const launches = loadLaunches();

  const [token2022Balances, splBalances] = await Promise.all([
    fetchTokenBalancesByMint(connection, owner, TOKEN_2022_PROGRAM_ID),
    fetchTokenBalancesByMint(connection, owner, TOKEN_PROGRAM_ID),
  ]);

  const relevantSymbols = collectRelevantSymbols(token2022Balances, splBalances);
  const marketsToFetch = MARKETS.filter((m) => relevantSymbols.has(m.symbol));

  const rows = await Promise.all(
    marketsToFetch.map(async (market) => {
      const underlyingMint = new PublicKey(market.mint);
      const underlyingBal = token2022Balances.get(market.mint);
      const underlying = {
        ui: underlyingBal?.ui ?? "0",
        raw: underlyingBal?.raw ?? 0n,
        decimals: underlyingBal?.decimals ?? 8,
      };

      const marketKey = marketPda(underlyingMint);
      const nonces = discoverYieldNonces(market, marketKey, splBalances);
      const ownedNonces = nonces.filter((yieldNonce) => {
        const pt = splBalances.get(
          ptMintPda(marketKey, yieldNonce).toBase58()
        );
        const yt = splBalances.get(
          ytMintPda(marketKey, yieldNonce).toBase58()
        );
        return (pt?.raw ?? 0n) > 0n || (yt?.raw ?? 0n) > 0n;
      });

      const seriesHoldings = await Promise.all(
        ownedNonces.map(async (yieldNonce) => {
          const ptMint = ptMintPda(marketKey, yieldNonce);
          const ytMint = ytMintPda(marketKey, yieldNonce);
          const pt = splBalances.get(ptMint.toBase58());
          const yt = splBalances.get(ytMint.toBase58());
          const ptRaw = pt?.raw ?? 0n;
          const ytRaw = yt?.raw ?? 0n;

          const series = seriesPda(marketKey, yieldNonce);
          const seriesInfo = await connection.getAccountInfo(series);

          return {
            yieldNonce,
            seriesExists: Boolean(seriesInfo),
            ptAmount: formatRawAmount(ptRaw, underlying.decimals),
            ytAmount: formatRawAmount(ytRaw, underlying.decimals),
            ptRaw,
            ytRaw,
          };
        })
      );

      const symbolLaunches = launches.filter((l) => l.symbol === market.symbol);
      const dbcPools = await Promise.all(
        symbolLaunches.map(async (launch) => {
          const snap = await withTimeout(
            fetchDbcPoolSnapshot(connection, launch.pool),
            DBC_SNAPSHOT_TIMEOUT_MS,
            "DBC pool snapshot"
          ).catch(() => null);
          const progressPct =
            snap != null ? Math.round(snap.quoteProgress * 100) : null;
          return {
            launch,
            progressPct,
            isMigrated: snap?.isMigrated ?? false,
            phase: snap
              ? snap.isMigrated
                ? "DAMM v2"
                : `curve-YT DBC · ${progressPct ?? 0}%`
              : "Unknown",
          };
        })
      );

      return {
        market,
        underlyingUi: underlying.ui,
        underlyingRaw: underlying.raw,
        decimals: underlying.decimals,
        windows: seriesHoldings.sort((a, b) => b.yieldNonce - a.yieldNonce),
        dbcPools,
      };
    })
  );

  return rows.filter(hasAnyBalance);
}

export async function fetchWalletPortfolio(
  connection: Connection,
  owner: PublicKey
): Promise<StockPortfolio[]> {
  return withTimeout(
    fetchWalletPortfolioInner(connection, owner),
    PORTFOLIO_TIMEOUT_MS,
    "Portfolio load"
  );
}
