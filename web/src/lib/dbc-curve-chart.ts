import { buildYtStripCurve } from "./meteora-dbc";

export type CurvePoint = { progress: number; mcapSol: number };

/** Sample implied mcap (USDC) along the DBC bonding curve for charting. */
export function sampleDbcCurve(fairCoupon: number, steps = 40): CurvePoint[] {
  const { initialMarketCap, migrationMarketCap, configParams } =
    buildYtStripCurve(fairCoupon);
  const threshold = Number(
    (configParams.migrationQuoteThreshold as { toString(): string }).toString()
  );
  const curve = configParams.curve as
    | { sqrtPrice: { toString(): string }; liquidity: { toString(): string } }[]
    | undefined;

  const points: CurvePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const progress = i / steps;
    let mcap = initialMarketCap;
    if (curve && curve.length >= 2 && threshold > 0) {
      const quoteRaised = progress * threshold;
      const seg = curve.length - 1;
      const segIdx = Math.min(seg, Math.floor(progress * seg));
      const segProgress = progress * seg - segIdx;
      const t = segProgress;
      mcap =
        initialMarketCap +
        (migrationMarketCap - initialMarketCap) *
          (t * t * (3 - 2 * t));
    } else {
      mcap =
        initialMarketCap +
        (migrationMarketCap - initialMarketCap) * progress ** 1.6;
    }
    points.push({ progress: progress * 100, mcapSol: mcap });
  }
  return points;
}
