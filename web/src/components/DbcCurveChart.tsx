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

// Sized to the real desk column (~300px) so SVG text renders near 1:1.
const W = 320;
const H = 196;
const PAD = { l: 42, r: 12, t: 22, b: 26 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

/** Shared chart scaffold so placeholder and live states occupy identical space. */
function ChartShell({
  meta,
  pill,
  placeholder,
  children,
}: {
  meta: React.ReactNode;
  pill?: string | null;
  placeholder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`dbc-chart${placeholder ? " dbc-chart-placeholder" : ""}`}>
      <div className="dbc-chart-head">
        <span className="dbc-chart-title">Bonding curve</span>
        <span className="mono dbc-chart-head-meta">
          {meta}
          {pill ? <span className="dbc-chart-progress-pill">{pill}</span> : null}
        </span>
      </div>
      <div className="dbc-chart-well">{children}</div>
    </div>
  );
}

function Grid() {
  return (
    <>
      {[0, 25, 50, 75, 100].map((pct) => {
        const x = PAD.l + (pct / 100) * INNER_W;
        return (
          <g key={pct}>
            <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + INNER_H} className="dbc-grid" />
            <text x={x} y={H - 10} textAnchor="middle" className="dbc-axis">
              {pct}%
            </text>
          </g>
        );
      })}
      <line
        x1={PAD.l}
        y1={PAD.t + INNER_H}
        x2={PAD.l + INNER_W}
        y2={PAD.t + INNER_H}
        className="dbc-baseline"
      />
    </>
  );
}

export function DbcCurveChart({
  fairCoupon,
  initialMcap,
  migrationMcap,
  avgDistributionUsd,
  fairMarketCapUsd,
  progressPct,
  placeholder = false,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const points = useMemo(
    () =>
      sampleDbcCurve(
        fairCoupon,
        placeholder ? undefined : (avgDistributionUsd ?? undefined),
        64
      ),
    [fairCoupon, avgDistributionUsd, placeholder]
  );

  const fairMcap = placeholder
    ? null
    : (fairMarketCapUsd ??
      (avgDistributionUsd != null && avgDistributionUsd > 0
        ? Math.round(100_000 * avgDistributionUsd)
        : null));

  const curveMax = Math.max(...points.map((p) => p.mcapSol));
  const curveMin = Math.min(...points.map((p) => p.mcapSol));
  const maxY = placeholder
    ? curveMax * 1.08
    : Math.max(fairMcap ?? 0, migrationMcap, curveMax) * 1.08;
  const minY = placeholder
    ? curveMin * 0.9
    : Math.min(initialMcap, curveMin) * 0.9;

  const toX = (progress: number) => PAD.l + (progress / 100) * INNER_W;
  const toY = (mcap: number) =>
    PAD.t + INNER_H - ((mcap - minY) / (maxY - minY || 1)) * INNER_H;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.progress).toFixed(1)},${toY(p.mcapSol).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${toX(100).toFixed(1)},${PAD.t + INNER_H} L${toX(0).toFixed(1)},${PAD.t + INNER_H} Z`;

  const defs = (
    <defs>
      <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#9945FF" />
        <stop offset="1" stopColor="#14F195" />
      </linearGradient>
      <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#14F195" stopOpacity="0.28" />
        <stop offset="0.6" stopColor="#9945FF" stopOpacity="0.1" />
        <stop offset="1" stopColor="#9945FF" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${uid}-filled`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#14F195" stopOpacity="0.55" />
        <stop offset="1" stopColor="#14F195" stopOpacity="0.05" />
      </linearGradient>
    </defs>
  );

  if (placeholder) {
    return (
      <ChartShell meta="—" placeholder>
        <svg viewBox={`0 0 ${W} ${H}`} className="dbc-chart-svg" role="img" aria-label="Bonding curve preview (pool not launched)">
          {defs}
          <Grid />
          <path d={areaPath} fill={`url(#${uid}-area)`} opacity={0.5} />
          <path d={linePath} className="dbc-line dbc-line-ghost" fill="none" stroke={`url(#${uid}-line)`} />
          <g className="dbc-empty-note">
            <rect x={W / 2 - 124} y={PAD.t + INNER_H / 2 - 15} width={248} height={28} rx={14} />
            <text x={W / 2} y={PAD.t + INNER_H / 2 + 3} textAnchor="middle">
              Launch a pool to see the live curve
            </text>
          </g>
        </svg>
      </ChartShell>
    );
  }

  const clamped =
    progressPct != null ? Math.min(100, Math.max(0, progressPct)) : null;

  const mcapAt = (pct: number) => {
    if (pct <= points[0].progress) return points[0].mcapSol;
    const nextIdx = points.findIndex((p) => p.progress >= pct);
    if (nextIdx < 0) return points[points.length - 1].mcapSol;
    const next = points[nextIdx];
    const prev = points[Math.max(0, nextIdx - 1)];
    const t = (pct - prev.progress) / (next.progress - prev.progress || 1);
    return prev.mcapSol + (next.mcapSol - prev.mcapSol) * t;
  };

  const dotX = clamped != null ? toX(clamped) : null;
  const dotY = clamped != null ? toY(mcapAt(clamped)) : null;
  const pill = clamped != null ? `${Math.round(clamped)}%` : null;
  const fairY = fairMcap != null ? toY(fairMcap) : null;
  const yTicks = [minY + (maxY - minY) * 0.1, (minY + maxY) / 2, maxY * 0.98];

  const tipW = 100;
  const tipX =
    dotX != null ? Math.min(Math.max(dotX - tipW / 2, PAD.l + 2), PAD.l + INNER_W - tipW - 2) : 0;
  const tipAbove = dotY != null && dotY - 40 > PAD.t;
  const tipY = dotY != null ? (tipAbove ? dotY - 38 : dotY + 14) : 0;

  return (
    <ChartShell meta={`${fmtK(initialMcap)} → ${fmtK(migrationMcap)}`} pill={pill}>
      <svg viewBox={`0 0 ${W} ${H}`} className="dbc-chart-svg" role="img" aria-label="Meteora DBC bonding curve">
        {defs}
        <Grid />
        {yTicks.map((v) => (
          <text key={v} x={PAD.l - 8} y={toY(v) + 3} textAnchor="end" className="dbc-axis">
            {fmtK(v)}
          </text>
        ))}

        <path d={areaPath} fill={`url(#${uid}-area)`} />
        {dotX != null ? (
          <>
            <defs>
              <clipPath id={`${uid}-done`}>
                <rect x={PAD.l} y={PAD.t} width={Math.max(0, dotX - PAD.l)} height={INNER_H} />
              </clipPath>
            </defs>
            <path d={areaPath} fill={`url(#${uid}-filled)`} clipPath={`url(#${uid}-done)`} />
          </>
        ) : null}
        <path d={linePath} className="dbc-line-glow" fill="none" stroke={`url(#${uid}-line)`} />
        <path d={linePath} className="dbc-line" fill="none" stroke={`url(#${uid}-line)`} />

        {fairY != null && fairY >= PAD.t ? (
          <g className="dbc-fair">
            <line x1={PAD.l} y1={fairY} x2={PAD.l + INNER_W} y2={fairY} className="dbc-fair-line" />
            <rect x={PAD.l + 6} y={fairY - 9} width={78} height={18} rx={9} className="dbc-fair-pill" />
            <text x={PAD.l + 45} y={fairY + 3.5} textAnchor="middle" className="dbc-fair-label">
              fair {fmtK(fairMcap!)}
            </text>
          </g>
        ) : null}

        <g className="dbc-grad-mark">
          <line x1={toX(100)} y1={PAD.t} x2={toX(100)} y2={PAD.t + INNER_H} />
          <text x={toX(100)} y={PAD.t - 8} textAnchor="end">
            graduate → DAMM
          </text>
        </g>

        {dotX != null && dotY != null && pill ? (
          <g className="dbc-progress">
            <line x1={dotX} y1={dotY} x2={dotX} y2={PAD.t + INNER_H} className="dbc-progress-line" />
            <circle cx={dotX} cy={dotY} r={9} className="dbc-progress-ring" />
            <circle cx={dotX} cy={dotY} r={4.5} className="dbc-progress-dot" />
            <g className="dbc-tip">
              <rect x={tipX} y={tipY} width={tipW} height={24} rx={5} />
              <text x={tipX + tipW / 2} y={tipY + 16} textAnchor="middle">
                {pill} · {fmtK(mcapAt(clamped!))}
              </text>
            </g>
          </g>
        ) : null}
      </svg>
    </ChartShell>
  );
}
