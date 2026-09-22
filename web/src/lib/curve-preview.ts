/**
 * Client-safe curve band preview — no Meteora SDK (browser + charts only).
 */
import { computeCurvePolicy, type CurvePolicy } from "./curve-policy";

export type CurvePreview = {
  initialMarketCap: number;
  migrationMarketCap: number;
  policy: CurvePolicy;
};

export function previewYtStripCurve(
  fairCoupon: number,
  avgDistributionUsd?: number,
  startingPriceRatio?: number
): CurvePreview {
  const policy = computeCurvePolicy({
    fairCoupon,
    avgDistributionUsd: avgDistributionUsd ?? 1,
    startingPriceRatio,
  });
  return {
    initialMarketCap: policy.initialMarketCapUsd,
    migrationMarketCap: policy.migrationMarketCapUsd,
    policy,
  };
}
