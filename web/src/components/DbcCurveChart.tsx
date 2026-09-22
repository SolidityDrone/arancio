import { useId, useMemo } from "react";
import { sampleDbcCurve } from "../lib/dbc-curve-chart";

type Props = {
  fairCoupon: number;
  initialMcap: number;
  migrationMcap: number;
  avgDistributionUsd?: number | null;
  fairMarketCapUsd?: number | null;
  progressPct?: number | null;
  compact?: boolean;
  placeholder?: boolean;
};

export function DbcCurveChart({
  fairCoupon,
  initialMcap,
  migrationMcap,
  avgDistributionUsd,
  fairMarketCapUsd,
  progressPct,
  compact = false,
  placeholder = false,
}: Props) {
  const width = compact ? 360 : 420;
  const height = compact ? 112 : 160;

  if (placeholder) {
    return (
      <div className={`dbc-chart dbc-chart-placeholder ${compact ? "dbc-chart-compact" : ""}`}>
        <div className="dbc-chart-head">
          <span>Bonding curve (USDC mcap)</span>
          <span className="mono dbc-chart-head-meta">—</span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="dbc-chart-svg"
          role="img"
          aria-hidden
        >
          <rect
            x={32}
            y={10}
            width={width - 42}
            height={height - 32}
            className="dbc-chart-placeholder-frame"
          />
        </svg>
      </div>
    );
  }

  const fillId = useId().replace(/:/g, "");
  const points = useMemo(
    () => sampleDbcCurve(fairCoupon, avgDistributionUsd ?? undefined, 48),
    [fairCoupon, avgDistributionUsd]
  );
  const clampedProgress =
    progressPct != null
      ? Math.min(100, Math.max(0, progressPct))
      : null;
  const pad = compact
    ? { l: 32, r: 10, t: 10, b: 22 }
    : { l: 36, r: 12, t: 14, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const fairMcap =
    fairMarketCapUsd ??
    (avgDistributionUsd != null && avgDistributionUsd > 0
      ? Math.round(100_000 * avgDistributionUsd)
      : null);
  const maxY = Math.max(
    fairMcap ?? migrationMcap * 1.05,
    migrationMcap * 1.05,
    ...points.map((p) => p.mcapSol)
  );
  const minY = Math.min(initialMcap * 0.95, ...points.map((p) => p.mcapSol));

  const toX = (progress: number) => pad.l + (progress / 100) * innerW;
  const toY = (mcap: number) =>
    pad.t + innerH - ((mcap - minY) / (maxY - minY || 1)) * innerH;
  const fairY = fairMcap != null ? toY(fairMcap) : null;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.progress).toFixed(1)} ${toY(p.mcapSol).toFixed(1)}`)
    .join(" ");

  const fillPath = `${path} L ${toX(100).toFixed(1)} ${(pad.t + innerH).toFixed(1)} L ${toX(0).toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;

  const mcapAtProgress = (pct: number) => {
    if (points.length === 0) return initialMcap;
    if (pct <= points[0].progress) return points[0].mcapSol;
    if (pct >= points[points.length - 1].progress) {
      return points[points.length - 1].mcapSol;
    }
    const nextIdx = points.findIndex((p) => p.progress >= pct);
    if (nextIdx < 0) return points[points.length - 1].mcapSol;
    const next = points[nextIdx];
    const prev = points[Math.max(0, nextIdx - 1)];
    const span = next.progress - prev.progress || 1;
    const t = (pct - prev.progress) / span;
    return prev.mcapSol + (next.mcapSol - prev.mcapSol) * t;
  };

  const dotX = clampedProgress != null ? toX(clampedProgress) : null;
  const dotY =
    clampedProgress != null ? toY(mcapAtProgress(clampedProgress)) : null;
  const progressLabel =
    clampedProgress != null ? `${Math.round(clampedProgress)}%` : null;
  const labelAbove = dotY != null && dotY > pad.t + 18;

  return (
    <div className={`dbc-chart ${compact ? "dbc-chart-compact" : ""}`}>
      <div className="dbc-chart-head">
        <span>Bonding curve (USDC mcap)</span>
        <span className="mono dbc-chart-head-meta">
          {initialMcap.toLocaleString()} → {migrationMcap.toLocaleString()}
          {progressLabel ? (
            <span className="dbc-chart-progress-pill">{progressLabel}</span>
          ) : null}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="dbc-chart-svg"
        role="img"
        aria-label="Meteora DBC bonding curve"
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((pct) => (
          <line
            key={pct}
            x1={toX(pct)}
            y1={pad.t}
            x2={toX(pct)}
            y2={pad.t + innerH}
            className="dbc-grid"
          />
        ))}
        <path d={fillPath} fill={`url(#${fillId})`} />
        <path d={path} className="dbc-line" fill="none" />
        {fairY != null && fairMcap != null && fairMcap > migrationMcap ? (
          <>
            <line
              x1={pad.l}
              y1={fairY}
              x2={pad.l + innerW}
              y2={fairY}
              className="dbc-fair-line"
            />
            <text
              x={pad.l + innerW - 2}
              y={fairY - 4}
              textAnchor="end"
              className="dbc-fair-label"
            >
              fair {Math.round(fairMcap).toLocaleString()}
            </text>
          </>
        ) : null}
        {dotX != null && dotY != null && progressLabel ? (
          <>
            <line
              x1={dotX}
              y1={pad.t}
              x2={dotX}
              y2={pad.t + innerH}
              className="dbc-progress-line"
            />
            <circle
              cx={dotX}
              cy={dotY}
              r={5}
              className="dbc-progress-dot"
            />
            <rect
              x={dotX - 16}
              y={labelAbove ? dotY - 22 : dotY + 8}
              width={32}
              height={14}
              rx={2}
              className="dbc-progress-label-bg"
            />
            <text
              x={dotX}
              y={labelAbove ? dotY - 12 : dotY + 18}
              textAnchor="middle"
              className="dbc-progress-label"
            >
              {progressLabel}
            </text>
          </>
        ) : null}
        <text x={pad.l} y={height - 6} className="dbc-axis">
          0%
        </text>
        <text x={width - pad.r - 24} y={height - 6} className="dbc-axis">
          100%
        </text>
        <text x={4} y={pad.t + 4} className="dbc-axis">
          {Math.round(maxY)} USDC
        </text>
      </svg>
    </div>
  );
}
