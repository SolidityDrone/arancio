import { useMemo } from "react";
import {
  computeCurvePolicy,
  DEFAULT_MIGRATION_RATIO,
  DEFAULT_STARTING_RATIO,
} from "../lib/curve-policy";

type Props = {
  avgDistributionUsd: number | null | undefined;
  fairCoupon: number;
  initialMcap?: number;
  migrationMcap?: number;
  progressPct?: number | null;
  isMigrated?: boolean;
  compact?: boolean;
  /** Fixed "—" metrics when pool is not live (avoids layout flicker on symbol change). */
  placeholder?: boolean;
};

const PLACEHOLDER = "—";

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toLocaleString()}`;
}

function PolicyFillSlot({
  fill,
  migration,
  isMigrated,
}: {
  fill: number | null;
  migration: number | null;
  isMigrated: boolean;
}) {
  const active =
    fill != null && migration != null && !isMigrated;
  return (
    <div
      className={`curve-policy-fill${active ? "" : " curve-policy-fill-reserved"}`}
      aria-hidden={!active}
    >
      <div className="curve-policy-fill-labels">
        <span>{active ? "USDC fill" : "\u00a0"}</span>
        <span className="mono">
          {active
            ? `${Math.round(fill)}% · target ${fmtUsd(migration)}`
            : "\u00a0"}
        </span>
      </div>
      <div
        className="curve-policy-fill-track"
        role={active ? "progressbar" : undefined}
        aria-valuenow={active ? Math.round(fill) : undefined}
        aria-valuemin={active ? 0 : undefined}
        aria-valuemax={active ? 100 : undefined}
      >
        {active ? (
          <>
            <div
              className="curve-policy-fill-bar"
              style={{ width: `${fill}%` }}
            />
            <div
              className="curve-policy-fill-fair"
              style={{ left: "100%" }}
              title="100% fair (not on curve)"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function CurvePolicyBand({
  avgDistributionUsd,
  fairCoupon,
  initialMcap,
  migrationMcap,
  progressPct,
  isMigrated = false,
  compact = false,
  placeholder = false,
}: Props) {
  const policy = useMemo(() => {
    if (placeholder) return null;
    if (avgDistributionUsd == null || avgDistributionUsd <= 0) return null;
    return computeCurvePolicy({
      avgDistributionUsd,
      fairCoupon,
    });
  }, [avgDistributionUsd, fairCoupon, placeholder]);

  const initial = initialMcap ?? policy?.initialMarketCapUsd ?? null;
  const migration = migrationMcap ?? policy?.migrationMarketCapUsd ?? null;
  const fair = policy?.fairMarketCapUsd ?? null;
  const fill =
    progressPct != null
      ? Math.min(100, Math.max(0, progressPct))
      : null;

  if (placeholder) {
    return (
      <div
        className={`curve-policy-band curve-policy-band-placeholder ${compact ? "curve-policy-band-compact" : ""}`}
      >
        <div className="curve-policy-head">
          <span className="curve-policy-title">Equity curve band</span>
          <span className="curve-policy-status">Not launched</span>
        </div>
        <div className="curve-policy-metrics">
          <div className="curve-policy-metric">
            <span className="curve-policy-metric-label">Avg cash div</span>
            <span className="mono curve-policy-metric-value">{PLACEHOLDER}</span>
          </div>
          <div className="curve-policy-metric">
            <span className="curve-policy-metric-label">Fair mcap</span>
            <span className="mono curve-policy-metric-value">{PLACEHOLDER}</span>
          </div>
          <div className="curve-policy-metric curve-policy-metric-wide">
            <span className="curve-policy-metric-label">
              DBC band ({Math.round(DEFAULT_STARTING_RATIO * 100)}→
              {Math.round(DEFAULT_MIGRATION_RATIO * 100)}% fair)
            </span>
            <span className="mono curve-policy-metric-value">{PLACEHOLDER}</span>
          </div>
        </div>
        <PolicyFillSlot fill={null} migration={null} isMigrated={false} />
      </div>
    );
  }

  if (!policy && initial == null && migration == null) {
    return (
      <div
        className={`curve-policy-band curve-policy-band-placeholder ${compact ? "curve-policy-band-compact" : ""}`}
      >
        <div className="curve-policy-head">
          <span className="curve-policy-title">Equity curve band</span>
          <span className="curve-policy-status">No div data</span>
        </div>
        <div className="curve-policy-metrics">
          <div className="curve-policy-metric">
            <span className="curve-policy-metric-label">Avg cash div</span>
            <span className="mono curve-policy-metric-value">{PLACEHOLDER}</span>
          </div>
          <div className="curve-policy-metric">
            <span className="curve-policy-metric-label">Fair mcap</span>
            <span className="mono curve-policy-metric-value">{PLACEHOLDER}</span>
          </div>
          <div className="curve-policy-metric curve-policy-metric-wide">
            <span className="curve-policy-metric-label">
              DBC band ({Math.round(DEFAULT_STARTING_RATIO * 100)}→
              {Math.round(DEFAULT_MIGRATION_RATIO * 100)}% fair)
            </span>
            <span className="mono curve-policy-metric-value">{PLACEHOLDER}</span>
          </div>
        </div>
        <p className="hint curve-policy-blocked-note">
          No xStocks cash-dividend history — launch blocked until dividend data
          exists.
        </p>
        <PolicyFillSlot fill={null} migration={null} isMigrated={false} />
      </div>
    );
  }

  const statusLabel = isMigrated
    ? "Graduated · DAMM v2"
    : fill != null && fill >= 99.5
      ? "Curve full · ready to migrate"
      : fill != null
        ? "DBC bonding · filling"
        : "Policy preview";

  const statusClass = isMigrated
    ? "curve-policy-status-migrated"
    : fill != null && fill >= 99.5
      ? "curve-policy-status-ready"
      : "curve-policy-status-active";

  return (
    <div className={`curve-policy-band ${compact ? "curve-policy-band-compact" : ""}`}>
      <div className="curve-policy-head">
        <span className="curve-policy-title">Equity curve band</span>
        <span className={`curve-policy-status ${statusClass}`}>{statusLabel}</span>
      </div>

      <div className="curve-policy-metrics">
        <div className="curve-policy-metric">
          <span className="curve-policy-metric-label">Avg cash div</span>
          <span className="mono curve-policy-metric-value">
            {avgDistributionUsd != null && avgDistributionUsd > 0
              ? `$${avgDistributionUsd.toFixed(3)}/sh`
              : PLACEHOLDER}
          </span>
        </div>
        <div className="curve-policy-metric">
          <span className="curve-policy-metric-label">Fair mcap</span>
          <span className="mono curve-policy-metric-value">
            {fair != null ? fmtUsd(fair) : PLACEHOLDER}
          </span>
        </div>
        <div className="curve-policy-metric curve-policy-metric-wide">
          <span className="curve-policy-metric-label">
            DBC band ({Math.round(DEFAULT_STARTING_RATIO * 100)}→
            {Math.round(DEFAULT_MIGRATION_RATIO * 100)}% fair)
          </span>
          <span className="mono curve-policy-metric-value">
            {initial != null && migration != null
              ? `${fmtUsd(initial)} → ${fmtUsd(migration)} USDC`
              : PLACEHOLDER}
          </span>
        </div>
      </div>

      <PolicyFillSlot
        fill={fill}
        migration={migration}
        isMigrated={isMigrated}
      />
    </div>
  );
}
