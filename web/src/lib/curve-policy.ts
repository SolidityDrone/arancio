/**
 * Canonical Meteora DBC params for a strip window — not memecoin defaults.
 */

export type CurvePolicyInput = {
  fairCoupon: number;
  lockNonces: number;
  /** Optional xStock reference notional in USDC (whole dollars). */
  refNotionalUsd?: number;
};

export type CurvePolicy = {
  totalTokenSupply: number;
  initialMarketCapUsd: number;
  migrationMarketCapUsd: number;
  launchFairPpm: number;
};

const MIN_INITIAL_MCAP = 5_000;
const MIN_MIGRATION_MCAP = 50_000;

/** Fair coupon → parts-per-million for on-chain register_curve_launch. */
export function fairCouponToPpm(fairCoupon: number): number {
  const ppm = Math.round(Math.max(0, Math.min(1, fairCoupon)) * 1_000_000);
  return Math.max(ppm, 1);
}

export function computeCurvePolicy(input: CurvePolicyInput): CurvePolicy {
  const lock = Math.max(1, Math.floor(input.lockNonces));
  const fair = Math.max(0, Math.min(1, input.fairCoupon));
  const ref = input.refNotionalUsd ?? 100;

  const yieldNotional = ref * fair * lock;
  const initialMarketCapUsd = Math.max(
    MIN_INITIAL_MCAP,
    Math.round(Math.max(yieldNotional, MIN_INITIAL_MCAP * 0.5))
  );
  const migrationMarketCapUsd = Math.max(
    MIN_MIGRATION_MCAP,
    initialMarketCapUsd * 15
  );

  // Strip-shaped supply: millions per lock nonce, not 1B memecoin float.
  const totalTokenSupply = Math.max(1_000_000, lock * 1_000_000);

  return {
    totalTokenSupply,
    initialMarketCapUsd,
    migrationMarketCapUsd,
    launchFairPpm: fairCouponToPpm(fair),
  };
}
