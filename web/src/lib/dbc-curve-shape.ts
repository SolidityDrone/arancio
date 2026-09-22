/**
 * Concave strip DBC shape: price rises faster early (~60%→~78% fair),
 * then flattens toward ~80% fair. Meteora uses 16 segments + liquidityWeights.
 */

/** Target price as % of fair — concave band, never above 100% fair. */
export const STRIP_FAIR_PRICE_KNOTS = [
  0.6, 0.64, 0.68, 0.72, 0.75, 0.77, 0.79, 0.8,
] as const;

export const STRIP_DBC_SEGMENTS = 16;

/** Interpolate target fair-ratio at progress t ∈ [0, 1]. */
export function fairPriceRatioAtProgress(t: number): number {
  const knots = STRIP_FAIR_PRICE_KNOTS;
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (knots.length - 1);
  const i = Math.min(knots.length - 2, Math.floor(pos));
  const frac = pos - i;
  return knots[i] + (knots[i + 1] - knots[i]) * frac;
}

/**
 * Liquidity weights for Meteora `buildCurveWithLiquidityWeights`.
 * Lower weight → less depth → price moves faster through that segment.
 */
export function stripLiquidityWeights(segments = STRIP_DBC_SEGMENTS): number[] {
  const boundaries = Array.from({ length: segments + 1 }, (_, i) =>
    fairPriceRatioAtProgress(i / segments)
  );
  const raw = boundaries.slice(1).map((p, i) => {
    const delta = Math.max(p - boundaries[i], 0.001);
    return 1 / delta;
  });
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((w) => Math.round((w / mean) * 100) / 100);
}

/** Sample implied fair-ratio along the target shape (for charts / docs). */
export function sampleStripFairBand(steps = 10): { progressPct: number; fairRatio: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { progressPct: Math.round(t * 100), fairRatio: fairPriceRatioAtProgress(t) };
  });
}
