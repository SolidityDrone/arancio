import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DBC_BASE_DECIMALS,
  DBC_QUOTE_DECIMALS,
  fetchDbcPoolSnapshot,
  formatDbcAmount,
  quoteDbcSwapExactIn,
  type DbcPoolSnapshot,
} from "./dbc-pool-desk";
import { curveYtVaultAccounts, fetchCurveYtVaultState } from "./strip-vault-tx";
import type { StripWindow } from "./strip-tx";

export type StripExitQuote = {
  stripYtIn: BN;
  curveYtOut: BN;
  minCurveYtOut: BN;
  quotePerCurveYt: number;
  fairMultiplier: number;
  impliedQuoteValue: string;
};

export type CurveYtVaultMetrics = {
  initialized: boolean;
  vaultExists: boolean;
  curveMintMatch: boolean;
  vaultPda: string;
  vaultCurveYtRaw: bigint;
  vaultStripYtRaw: bigint;
  walletCurveYtRaw: bigint;
  pool: DbcPoolSnapshot | null;
  spotQuotePerCurveYt: number | null;
  fairMultiplier: number;
  fairCoupon: number;
  launchFairCoupon: number;
  maxStripExitRaw: bigint;
  poolQuoteReserveUi: string;
  poolBaseReserveUi: string;
  quoteProgressPct: number | null;
  isMigrated: boolean;
  loadError: string | null;
};

export function rawToUiNumber(raw: BN | bigint, decimals: number): number {
  const n = typeof raw === "bigint" ? raw.toString() : raw.toString(10);
  return Number(n) / 10 ** decimals;
}

export function fairCouponMultiplier(
  fairCoupon: number,
  launchFairCoupon: number
): number {
  return launchFairCoupon > 0 ? fairCoupon / launchFairCoupon : 1;
}

/** Spot USDC per curve-YT from a small buy quote on the DBC pool. */
export async function spotQuotePerCurveYt(
  connection: Connection,
  pool: PublicKey | string
): Promise<number | null> {
  const probeQuote = "100";
  const buy = await quoteDbcSwapExactIn(
    connection,
    pool,
    probeQuote,
    false,
    0
  );
  if (!buy || buy.outputAmount.isZero()) return null;
  const curveUi = rawToUiNumber(buy.outputAmount, DBC_BASE_DECIMALS);
  if (curveUi <= 0) return null;
  return Number(probeQuote) / curveUi;
}

/** @deprecated use spotQuotePerCurveYt */
export const spotSolPerCurveYt = spotQuotePerCurveYt;

/**
 * Strip exit quote at DBC/DAMM spot:
 * 1. Value strip YT at current pool sell-side USDC.
 * 2. Adjust by fair coupon vs launch reference.
 * 3. Re-quote buy-side curve-YT for that USDC notional.
 */
export async function quoteStripYtForCurveYtAtSpot(
  connection: Connection,
  pool: PublicKey | string,
  stripYtRaw: BN,
  fairCoupon: number,
  launchFairCoupon: number,
  slippageBps = 100
): Promise<StripExitQuote | null> {
  if (stripYtRaw.isZero()) return null;

  const stripUi = rawToUiNumber(stripYtRaw, DBC_BASE_DECIMALS);
  const stripUiStr = stripUi.toFixed(DBC_BASE_DECIMALS).replace(/\.?0+$/, "");

  const sellQuote = await quoteDbcSwapExactIn(
    connection,
    pool,
    stripUiStr,
    true,
    0
  );
  if (!sellQuote) return null;

  const quotePerCurve = await spotQuotePerCurveYt(connection, pool);
  if (quotePerCurve == null) return null;

  const fairMultiplier = fairCouponMultiplier(fairCoupon, launchFairCoupon);
  const quoteUi =
    rawToUiNumber(sellQuote.outputAmount, DBC_QUOTE_DECIMALS) * fairMultiplier;
  if (quoteUi <= 0) return null;

  const quoteUiStr = quoteUi.toFixed(DBC_QUOTE_DECIMALS).replace(/\.?0+$/, "");
  const buyQuote = await quoteDbcSwapExactIn(
    connection,
    pool,
    quoteUiStr,
    false,
    slippageBps
  );
  if (!buyQuote) return null;

  return {
    stripYtIn: stripYtRaw,
    curveYtOut: buyQuote.outputAmount,
    minCurveYtOut: buyQuote.minimumAmountOut,
    quotePerCurveYt: quotePerCurve,
    fairMultiplier,
    impliedQuoteValue: formatDbcAmount(sellQuote.outputAmount, true),
  };
}

export async function quoteCurveYtForStripYtAtSpot(
  connection: Connection,
  pool: PublicKey | string,
  curveYtRaw: BN,
  fairCoupon: number,
  launchFairCoupon: number,
  slippageBps = 100
): Promise<{
  curveYtIn: BN;
  stripYtOut: BN;
  minStripYtOut: BN;
} | null> {
  if (curveYtRaw.isZero()) return null;

  const curveUi = rawToUiNumber(curveYtRaw, DBC_BASE_DECIMALS);
  const curveUiStr = curveUi.toFixed(DBC_BASE_DECIMALS).replace(/\.?0+$/, "");

  const sellQuote = await quoteDbcSwapExactIn(
    connection,
    pool,
    curveUiStr,
    true,
    0
  );
  if (!sellQuote) return null;

  const fairMultiplier = fairCouponMultiplier(fairCoupon, launchFairCoupon);
  const quoteUi =
    rawToUiNumber(sellQuote.outputAmount, DBC_QUOTE_DECIMALS) / fairMultiplier;
  if (quoteUi <= 0) return null;

  const quoteUiStr = quoteUi.toFixed(DBC_QUOTE_DECIMALS).replace(/\.?0+$/, "");
  const buyQuote = await quoteDbcSwapExactIn(
    connection,
    pool,
    quoteUiStr,
    false,
    slippageBps
  );
  if (!buyQuote) return null;

  return {
    curveYtIn: curveYtRaw,
    stripYtOut: buyQuote.outputAmount,
    minStripYtOut: buyQuote.minimumAmountOut,
  };
}

async function estimateMaxStripExitRaw(
  connection: Connection,
  pool: PublicKey | string,
  vaultCurveYtRaw: bigint,
  fairCoupon: number,
  launchFairCoupon: number
): Promise<bigint> {
  if (vaultCurveYtRaw <= 0n) return 0n;
  try {
    const vaultCurveUi = rawToUiNumber(vaultCurveYtRaw, DBC_BASE_DECIMALS);
    const probeStripUi = Math.min(Math.max(vaultCurveUi, 0.000001), 1_000_000);
    const probe = await quoteStripYtForCurveYtAtSpot(
      connection,
      pool,
      new BN(Math.round(probeStripUi * 10 ** DBC_BASE_DECIMALS).toString()),
      fairCoupon,
      launchFairCoupon,
      0
    );
    if (!probe) return 0n;

    const vaultCurve = vaultCurveYtRaw;
    let lo = 0n;
    let hi = vaultCurve * 2n;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2n;
      if (mid <= lo) break;
      const q = await quoteStripYtForCurveYtAtSpot(
        connection,
        pool,
        new BN(mid.toString()),
        fairCoupon,
        launchFairCoupon,
        0
      );
      if (!q) break;
      if (BigInt(q.curveYtOut.toString()) <= vaultCurve) lo = mid;
      else hi = mid;
    }
    return lo;
  } catch {
    return 0n;
  }
}

export async function fetchCurveYtVaultMetrics(
  connection: Connection,
  window: StripWindow,
  curveYtMint: PublicKey,
  pool: PublicKey | string,
  wallet: PublicKey,
  fairCoupon: number,
  launchFairCoupon: number
): Promise<CurveYtVaultMetrics> {
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  const fairMultiplier = fairCouponMultiplier(fairCoupon, launchFairCoupon);
  let loadError: string | null = null;

  let vaultState = {
    initialized: false,
    vaultExists: false,
    curveMintMatch: false,
    vaultCurveYtRaw: 0n,
    vaultStripYtRaw: 0n,
    walletLcYtRaw: 0n,
    lcYtMint: null as PublicKey | null,
    vaultPda: a.vault,
    onChainCurveYtMint: null as PublicKey | null,
  };
  try {
    vaultState = await fetchCurveYtVaultState(connection, window, curveYtMint);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Vault state unavailable";
  }

  let poolSnap: DbcPoolSnapshot | null = null;
  try {
    poolSnap = await fetchDbcPoolSnapshot(connection, pool);
    if (!poolSnap) {
      loadError ??=
        "Pool not found on this RPC — check Surfpool is running and the pool address is valid.";
    }
  } catch (e) {
    loadError ??= e instanceof Error ? e.message : "Pool fetch failed";
  }

  let spot: number | null = null;
  if (poolSnap && !poolSnap.isMigrated) {
    try {
      spot = await spotQuotePerCurveYt(connection, pool);
    } catch {
      spot = null;
    }
  }

  let vaultStripYtRaw = 0n;
  try {
    const bal = await connection.getTokenAccountBalance(a.vaultStripYt);
    vaultStripYtRaw = BigInt(bal.value.amount);
  } catch {
    vaultStripYtRaw = 0n;
  }

  let walletCurveYtRaw = 0n;
  try {
    const bal = await connection.getTokenAccountBalance(a.userCurveYt);
    walletCurveYtRaw = BigInt(bal.value.amount);
  } catch {
    walletCurveYtRaw = 0n;
  }

  let maxStripExitRaw = 0n;
  if (poolSnap && !poolSnap.isMigrated && vaultState.vaultCurveYtRaw > 0n) {
    maxStripExitRaw = await estimateMaxStripExitRaw(
      connection,
      pool,
      vaultState.vaultCurveYtRaw,
      fairCoupon,
      launchFairCoupon
    );
  }

  return {
    initialized: vaultState.initialized,
    vaultExists: vaultState.vaultExists,
    curveMintMatch: vaultState.curveMintMatch,
    vaultPda: vaultState.vaultPda.toBase58(),
    vaultCurveYtRaw: vaultState.vaultCurveYtRaw,
    vaultStripYtRaw,
    walletCurveYtRaw,
    pool: poolSnap,
    spotQuotePerCurveYt: spot,
    fairMultiplier,
    fairCoupon,
    launchFairCoupon,
    maxStripExitRaw,
    poolQuoteReserveUi: poolSnap?.quoteReserveUi ?? "—",
    poolBaseReserveUi: poolSnap?.baseReserveUi ?? "—",
    quoteProgressPct:
      poolSnap != null ? Math.round(poolSnap.quoteProgress * 100) : null,
    isMigrated: poolSnap?.isMigrated ?? false,
    loadError,
  };
}
