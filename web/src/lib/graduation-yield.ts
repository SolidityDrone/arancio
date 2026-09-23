/**
 * Post-graduation yield path (option B):
 * 1. Take USDC quote from graduated DBC / DAMM inventory
 * 2. Seed DAMM with migrationTarget USDC
 * 3. Vault parks remaining USDC in Kamino (cUSDC) and/or buys curve-YT to donate (NAV up)
 *
 * This module is the accounting helper + tx builders used by migrate scripts / crank.
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildCusdcRedeemTransaction,
  previewRedeemUsdc,
} from "./yield-cusdc";
import {
  buildKaminoRedeemTransaction,
  isKaminoYieldBackend,
} from "./kamino-usdc";
import {
  buildDonateCurveYtTransaction,
} from "./strip-vault-tx";
import type { StripSeriesRef } from "./strip-tx";
import { DEFAULT_QUOTE_MINT } from "./meteora-dbc";

export type GraduationYieldPlan = {
  totalUsdcFromCusdc: bigint;
  dammSeedUsdc: bigint;
  vaultBuyUsdc: bigint;
};

/** Split redeemed USDC: migration seed vs vault surplus (always deploy; never park). */
export function planGraduationYield(
  totalUsdcFromCusdc: bigint,
  migrationTargetUsdc: bigint
): GraduationYieldPlan {
  const dammSeedUsdc =
    totalUsdcFromCusdc < migrationTargetUsdc
      ? totalUsdcFromCusdc
      : migrationTargetUsdc;
  const vaultBuyUsdc = totalUsdcFromCusdc - dammSeedUsdc;
  return { totalUsdcFromCusdc, dammSeedUsdc, vaultBuyUsdc };
}

export function previewCusdcBagRedeem(
  vaultUsdc: bigint,
  cusdcSupply: bigint,
  cusdcInPool: bigint
): bigint {
  return previewRedeemUsdc(vaultUsdc, cusdcSupply, cusdcInPool);
}

/** Redeem cUSDC → USDC for a wallet (pool authority / crank after withdrawing quote). */
export async function buildRedeemPoolCusdcTransaction(
  connection: Connection,
  owner: PublicKey,
  cusdcAmount: bigint,
  usdcMint: PublicKey = DEFAULT_QUOTE_MINT
): Promise<Transaction> {
  if (isKaminoYieldBackend()) {
    return buildKaminoRedeemTransaction(connection, owner, cusdcAmount);
  }
  return buildCusdcRedeemTransaction(connection, owner, usdcMint, cusdcAmount);
}

/** Donate purchased curve-YT into vault — NAV up for remaining lcYT holders. */
export async function buildDeploySurplusToVaultTransaction(
  connection: Connection,
  donor: PublicKey,
  seriesRef: StripSeriesRef,
  curveYtMint: PublicKey,
  curveAmountRaw: bigint
): Promise<Transaction> {
  return buildDonateCurveYtTransaction(
    connection,
    donor,
    seriesRef,
    curveYtMint,
    curveAmountRaw
  );
}
