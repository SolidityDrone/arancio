import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  SwapMode,
  getCurrentPoint,
  deriveDammV2PoolAddress,
  type VirtualPool,
  type PoolConfig,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { QUOTE_DECIMALS } from "./meteora-dbc";

export const DBC_BASE_DECIMALS = 6;
export const DBC_QUOTE_DECIMALS = QUOTE_DECIMALS;

export type DbcPoolSnapshot = {
  pool: string;
  baseMint: string;
  quoteMint: string;
  config: string;
  isMigrated: boolean;
  quoteProgress: number;
  baseReserve: string;
  quoteReserve: string;
  baseReserveUi: string;
  quoteReserveUi: string;
  dammV2Pool: string | null;
};

function uiAmount(raw: BN, decimals: number): string {
  const s = raw.toString(10);
  if (decimals === 0) return s;
  const padded = s.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function parseUiToRaw(amount: string, decimals: number): BN | null {
  const trimmed = amount.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const paddedFrac = frac.padEnd(decimals, "0");
  const raw = `${whole || "0"}${paddedFrac}`.replace(/^0+/, "") || "0";
  try {
    return new BN(raw);
  } catch {
    return null;
  }
}

export async function fetchDbcPoolSnapshot(
  connection: Connection,
  poolAddress: PublicKey | string
): Promise<DbcPoolSnapshot | null> {
  try {
    const client = DynamicBondingCurveClient.create(connection, "confirmed");
    const poolPk =
      typeof poolAddress === "string"
        ? new PublicKey(poolAddress)
        : poolAddress;
    const virtualPool = await client.state.getPool(poolPk);
    if (!virtualPool) return null;

    const configPk = virtualPool.poolState.config;
    const config = await client.state.getPoolConfig(configPk);
    if (!config) return null;

    const quoteProgress =
      await client.state.getPoolQuoteTokenCurveProgress(poolPk);
    const ps = virtualPool.poolState;
    const baseReserve = new BN(ps.baseReserve.toString());
    const quoteReserve = new BN(ps.quoteReserve.toString());
    const isMigrated = Boolean(ps.isMigrated);

    let dammV2Pool: string | null = null;
    if (isMigrated) {
      try {
        dammV2Pool = deriveDammV2PoolAddress(
          configPk,
          ps.baseMint,
          config.quoteMint
        ).toBase58();
      } catch {
        dammV2Pool = null;
      }
    }

    return {
      pool: poolPk.toBase58(),
      baseMint: ps.baseMint.toBase58(),
      quoteMint: config.quoteMint.toBase58(),
      config: configPk.toBase58(),
      isMigrated,
      quoteProgress,
      baseReserve: baseReserve.toString(10),
      quoteReserve: quoteReserve.toString(10),
      baseReserveUi: uiAmount(baseReserve, DBC_BASE_DECIMALS),
      quoteReserveUi: uiAmount(quoteReserve, DBC_QUOTE_DECIMALS),
      dammV2Pool,
    };
  } catch {
    return null;
  }
}

async function loadPoolForQuote(
  connection: Connection,
  pool: PublicKey
): Promise<{
  client: DynamicBondingCurveClient;
  virtualPool: VirtualPool;
  config: PoolConfig;
  currentPoint: BN;
  eligibleForFirstSwapWithMinFee: boolean;
} | null> {
  const client = DynamicBondingCurveClient.create(connection, "confirmed");
  const virtualPool = await client.state.getPool(pool);
  if (!virtualPool) return null;
  const config = await client.state.getPoolConfig(virtualPool.poolState.config);
  if (!config) return null;
  const currentPoint = await getCurrentPoint(
    connection,
    config.activationType
  );
  const eligibleForFirstSwapWithMinFee =
    Boolean(config.enableFirstSwapWithMinFee) &&
    Number(virtualPool.poolState.hasSwap) === 0;
  return {
    client,
    virtualPool,
    config,
    currentPoint,
    eligibleForFirstSwapWithMinFee,
  };
}

export type DbcSwapQuote = {
  amountIn: BN;
  outputAmount: BN;
  minimumAmountOut: BN;
  swapBaseForQuote: boolean;
};

export async function quoteDbcSwapExactIn(
  connection: Connection,
  pool: PublicKey | string,
  amountUi: string,
  swapBaseForQuote: boolean,
  slippageBps = 100
): Promise<DbcSwapQuote | null> {
  const poolPk = typeof pool === "string" ? new PublicKey(pool) : pool;
  const decimals = swapBaseForQuote ? DBC_BASE_DECIMALS : DBC_QUOTE_DECIMALS;
  const amountIn = parseUiToRaw(amountUi, decimals);
  if (!amountIn || amountIn.isZero()) return null;

  const ctx = await loadPoolForQuote(connection, poolPk);
  if (!ctx) return null;
  if (ctx.virtualPool.poolState.isMigrated) return null;

  const quote = ctx.client.pool.swapQuote2({
    virtualPool: ctx.virtualPool,
    config: ctx.config,
    swapBaseForQuote,
    swapMode: SwapMode.ExactIn,
    amountIn,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: ctx.eligibleForFirstSwapWithMinFee,
    currentPoint: ctx.currentPoint,
  });

  return {
    amountIn,
    outputAmount: new BN(quote.outputAmount.toString()),
    minimumAmountOut: new BN(
      (quote.minimumAmountOut ?? quote.outputAmount).toString()
    ),
    swapBaseForQuote,
  };
}

export async function buildDbcSwapTransaction(
  connection: Connection,
  owner: PublicKey,
  pool: PublicKey | string,
  quote: DbcSwapQuote
) {
  const poolPk = typeof pool === "string" ? new PublicKey(pool) : pool;
  const client = DynamicBondingCurveClient.create(connection, "confirmed");
  return client.pool.swap({
    owner,
    pool: poolPk,
    amountIn: quote.amountIn,
    minimumAmountOut: quote.minimumAmountOut,
    swapBaseForQuote: quote.swapBaseForQuote,
    referralTokenAccount: null,
  });
}

/** Format a raw token amount; pass quote-side flag for USDC leg. */
export function formatDbcAmount(raw: BN, isQuoteToken: boolean): string {
  return uiAmount(raw, isQuoteToken ? DBC_QUOTE_DECIMALS : DBC_BASE_DECIMALS);
}

export function rawDbcToUiNumber(raw: BN | bigint, isQuoteToken: boolean): number {
  const decimals = isQuoteToken ? DBC_QUOTE_DECIMALS : DBC_BASE_DECIMALS;
  return Number(raw.toString()) / 10 ** decimals;
}

/** Readable amounts — compact for huge curve/lcYT counts, precise for USDC. */
export function formatDbcAmountCompact(
  raw: BN | bigint,
  isQuoteToken: boolean
): string {
  const ui = rawDbcToUiNumber(raw, isQuoteToken);
  if (!Number.isFinite(ui)) return "—";
  if (ui === 0) return "0";
  if (isQuoteToken) {
    return ui.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (ui >= 1_000_000) return `${(ui / 1_000_000).toFixed(2)}M`;
  if (ui >= 10_000) return `${(ui / 1_000).toFixed(2)}k`;
  return ui.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function isLocalRpc(endpoint: string): boolean {
  const e = endpoint.toLowerCase();
  return e.includes("127.0.0.1") || e.includes("localhost");
}
