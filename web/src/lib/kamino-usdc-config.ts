/**
 * Client-safe Kamino USDC constants (no @kamino-finance/klend-sdk — that package
 * requires Node `fs` and must not enter the browser bundle).
 */
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "./meteora-dbc";
import { cusdcMintPda } from "./yield-cusdc";

/** KLend program (mainnet). */
export const KLEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

/** Kamino main lending market. */
export const KAMINO_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);

/** Primary USDC reserve on the main market (~$100M+ supply). */
export const KAMINO_USDC_RESERVE = new PublicKey(
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
);

/**
 * USDC collateral (cToken) mint for {@link KAMINO_USDC_RESERVE}.
 * Vault / crank parks idle USDC here — not the DBC quote mint (users pay USDC).
 */
export const KAMINO_CUSDC_MINT = new PublicKey(
  "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"
);

export const KAMINO_QUOTE_SYMBOL = "cUSDC";

export type KaminoUsdcSnapshot = {
  reserve: string;
  cTokenMint: string;
  liquidityMint: string;
  /** cTokens minted per 1 USDC (raw/raw), falls as interest accrues. */
  cTokensPerUsdc: number;
  /** USDC redeemed per 1 cToken (raw/raw), rises as interest accrues. */
  usdcPerCtoken: number;
  /** Supply APY as a fraction (e.g. 0.04 = 4%). */
  supplyApy: number;
  slot: number;
  blockTime: number | null;
};

export type KaminoRedeemPreview = {
  cTokenAmount: bigint;
  redeemableUsdc: bigint;
  /** redeemable − cToken face (same decimals); >0 when cToken trades above 1 USDC. */
  accruedVsPar: bigint;
  usdcPerCtoken: number;
  supplyApy: number;
};

export function isKaminoYieldBackend(): boolean {
  const v = (process.env.NEXT_PUBLIC_ARANCIO_YIELD_BACKEND ??
    process.env.ARANCIO_YIELD_BACKEND ??
    "kamino").toLowerCase();
  return v !== "local" && v !== "yield_cusdc";
}

/**
 * DBC pool quote mint = native USDC.
 * Kamino cUSDC is vault inventory only (deposit after fill / graduation), never the
 * token users swap on the curve.
 */
export function yieldQuoteMint(usdcMint: PublicKey = USDC_MINT): PublicKey {
  if (!isKaminoYieldBackend()) {
    // Local yield_cusdc stand-in still quotes the curve in its cToken (tests).
    return cusdcMintPda(usdcMint);
  }
  if (!usdcMint.equals(USDC_MINT)) {
    throw new Error("Kamino path only supports native USDC liquidity mint");
  }
  return usdcMint;
}
