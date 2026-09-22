import { previewYtStripCurve } from "./curve-preview";
import { fairPriceRatioAtProgress, sampleStripFairBand } from "./dbc-curve-shape";

export type CurvePoint = { progress: number; mcapSol: number; fairRatio: number };

/** Sample target fair band and implied mcap for charting. */
export function sampleDbcCurve(
  fairCoupon: number,
  avgDistributionUsd?: number,
  steps = 40
): CurvePoint[] {
  const { initialMarketCap } = previewYtStripCurve(fairCoupon, avgDistributionUsd);
  const fairFromBand = initialMarketCap / fairPriceRatioAtProgress(0);

  const points: CurvePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const progress = i / steps;
    const fairRatio = fairPriceRatioAtProgress(progress);
    points.push({
      progress: progress * 100,
      mcapSol: fairFromBand * fairRatio,
      fairRatio,
    });
  }
  return points;
}

export { sampleStripFairBand, fairPriceRatioAtProgress };
