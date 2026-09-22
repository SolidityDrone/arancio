/**
 * Canonical Meteora DBC params for a single yield nonce — not memecoin defaults.
 * Curve spans ~60%–80% of fair mcap; graduation USDC floored/capped for reliability.
 */

export type CurvePolicyInput = {
  /** Average historical cash dividend per share (USDC). */
  avgDistributionUsd: number;
  /** Fair coupon for on-chain register_curve_launch (single step). */
  fairCoupon?: number;
  /** First-buyer mcap vs fair (default 0.60). */
  startingPriceRatio?: number;
  /** Migration mcap vs fair (default 0.80, always ≤ 1). */
  migrationFairRatio?: number;
};

export type CurvePolicy = {
  totalTokenSupply: number;
  fairMarketCapUsd: number;
  initialMarketCapUsd: number;
  migrationMarketCapUsd: number;
  launchFairPpm: number;
  /** True when graduation target was raised to minGraduationMcap. */
  graduationFloorApplied: boolean;
  /** True when graduation target was capped at maxGraduationMcap. */
  graduationCapApplied: boolean;
};

export const PER_NONCE_SUPPLY = 100_000;
export const DEFAULT_STARTING_RATIO = 0.6;
export const DEFAULT_MIGRATION_RATIO = 0.8;
export const MIN_INITIAL_MCAP = 5_000;
export const MIN_GRADUATION_MCAP = 30_000;
export const MAX_GRADUATION_MCAP = 120_000;
const DEFAULT_AVG_DIST_USD = 1;

/** Fair coupon → parts-per-million for on-chain register_curve_launch. */
export function fairCouponToPpm(fairCoupon: number): number {
  const ppm = Math.round(Math.max(0, Math.min(1, fairCoupon)) * 1_000_000);
  return Math.max(ppm, 1);
}

export function computeCurvePolicy(input: CurvePolicyInput): CurvePolicy {
  const avg =
    input.avgDistributionUsd > 0
      ? input.avgDistributionUsd
      : DEFAULT_AVG_DIST_USD;
  let startRatio =
    input.startingPriceRatio != null && input.startingPriceRatio > 0
      ? input.startingPriceRatio
      : DEFAULT_STARTING_RATIO;
  let migrationRatio =
    input.migrationFairRatio != null && input.migrationFairRatio > 0
      ? input.migrationFairRatio
      : DEFAULT_MIGRATION_RATIO;
  if (migrationRatio > 1) {
    migrationRatio = 1;
  }
  if (migrationRatio <= startRatio) {
    migrationRatio = Math.min(1, startRatio + 0.05);
  }
  const fairCoupon = Math.max(0, Math.min(1, input.fairCoupon ?? avg));

  const fairMarketCapUsd = Math.max(
    MIN_INITIAL_MCAP,
    Math.round(PER_NONCE_SUPPLY * avg)
  );
  let initialMarketCapUsd = Math.max(
    MIN_INITIAL_MCAP,
    Math.round(fairMarketCapUsd * startRatio)
  );
  let migrationMarketCapUsd = Math.round(fairMarketCapUsd * migrationRatio);
  let graduationFloorApplied = false;
  let graduationCapApplied = false;

  if (migrationMarketCapUsd < MIN_GRADUATION_MCAP) {
    migrationMarketCapUsd = MIN_GRADUATION_MCAP;
    graduationFloorApplied = true;
  }
  if (migrationMarketCapUsd > MAX_GRADUATION_MCAP) {
    migrationMarketCapUsd = MAX_GRADUATION_MCAP;
    graduationCapApplied = true;
  }
  if (migrationMarketCapUsd <= initialMarketCapUsd) {
    initialMarketCapUsd = Math.max(
      MIN_INITIAL_MCAP,
      migrationMarketCapUsd - 1_000
    );
  }

  return {
    totalTokenSupply: PER_NONCE_SUPPLY,
    fairMarketCapUsd,
    initialMarketCapUsd,
    migrationMarketCapUsd,
    launchFairPpm: fairCouponToPpm(fairCoupon),
    graduationFloorApplied,
    graduationCapApplied,
  };
}
