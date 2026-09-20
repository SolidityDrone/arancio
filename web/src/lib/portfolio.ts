import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { loadDeskActivities } from "./desk-activity";
import { fetchDbcPoolSnapshot } from "./dbc-pool-desk";
import { MARKETS, DIVSTRIP_PROGRAM_ID, type MarketConfig } from "./markets";
import { loadLaunches, type StoredLaunch } from "./meteora-dbc";
import { loadStripPositions } from "./strip-positions";
import { formatRawAmount } from "./strip-math";
import { fetchTokenBalance, fetchUnderlyingBalance } from "./spl-balance";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

export type WindowHolding = {
  startNonce: number;
  targetNonce: number;
  ptAmount: string;
  ytAmount: string;
  ptRaw: bigint;
  ytRaw: bigint;
  seriesExists: boolean;
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
  windows: WindowHolding[];
  dbcPools: DbcPoolRow[];
};

function marketPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strip"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

function seriesPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("series"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function ptMintPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pt-mint"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function ytMintPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yt-mint"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function windowKey(start: number, target: number) {
  return `${start}:${target}`;
}

function collectWindows(symbol: string): { start: number; target: number }[] {
  const seen = new Set<string>();
  const out: { start: number; target: number }[] = [];
  const add = (start: number, target: number) => {
    const key = windowKey(start, target);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ start, target });
  };

  for (const p of loadStripPositions()) {
    if (p.symbol === symbol) add(p.startNonce, p.targetNonce);
  }
  for (const l of loadLaunches()) {
    if (l.symbol === symbol) add(l.startNonce, l.targetNonce);
  }
  for (const a of loadDeskActivities()) {
    if (a.symbol === symbol) add(a.startNonce, a.targetNonce);
  }
  return out;
}

function hasAnyBalance(row: StockPortfolio): boolean {
  if (row.underlyingRaw > 0n) return true;
  if (row.windows.some((w) => w.ptRaw > 0n || w.ytRaw > 0n)) return true;
  if (row.dbcPools.length > 0) return true;
  return false;
}

export async function fetchWalletPortfolio(
  connection: Connection,
  owner: PublicKey
): Promise<StockPortfolio[]> {
  const launches = loadLaunches();

  const rows = await Promise.all(
    MARKETS.map(async (market) => {
      const underlyingMint = new PublicKey(market.mint);
      const underlying = await fetchUnderlyingBalance(
        connection,
        underlyingMint,
        owner
      );
      const marketKey = marketPda(underlyingMint);
      const windows = collectWindows(market.symbol);

      const windowHoldings = await Promise.all(
        windows.map(async ({ start, target }) => {
          const series = seriesPda(marketKey, start, target);
          const seriesInfo = await connection.getAccountInfo(series);
          if (!seriesInfo) {
            return {
              startNonce: start,
              targetNonce: target,
              seriesExists: false,
              ptAmount: "0",
              ytAmount: "0",
              ptRaw: 0n,
              ytRaw: 0n,
            };
          }
          const [pt, yt] = await Promise.all([
            fetchTokenBalance(
              connection,
              ptMintPda(marketKey, start, target),
              owner,
              TOKEN_PROGRAM_ID
            ),
            fetchTokenBalance(
              connection,
              ytMintPda(marketKey, start, target),
              owner,
              TOKEN_PROGRAM_ID
            ),
          ]);
          return {
            startNonce: start,
            targetNonce: target,
            seriesExists: true,
            ptAmount: formatRawAmount(pt.raw, underlying.decimals),
            ytAmount: formatRawAmount(yt.raw, underlying.decimals),
            ptRaw: pt.raw,
            ytRaw: yt.raw,
          };
        })
      );

      const symbolLaunches = launches.filter((l) => l.symbol === market.symbol);
      const dbcPools = await Promise.all(
        symbolLaunches.map(async (launch) => {
          const snap = await fetchDbcPoolSnapshot(connection, launch.pool);
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
        windows: windowHoldings.sort(
          (a, b) => b.startNonce - a.startNonce || b.targetNonce - a.targetNonce
        ),
        dbcPools,
      };
    })
  );

  return rows.filter(hasAnyBalance);
}
