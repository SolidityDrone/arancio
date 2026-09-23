import { useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { CurvePolicyBand } from "./CurvePolicyBand";
import { DbcCurveChart } from "./DbcCurveChart";
import { computeCurvePolicy } from "../lib/curve-policy";
import {
  launchYieldNonce,
  type StoredLaunch,
} from "../lib/meteora-dbc";
import { previewYtStripCurve } from "../lib/curve-preview";
import { DbcPoolPanel } from "./DbcPoolPanel";
import { fetchWindowCumYs } from "../lib/registry-cum-y";
import {
  formatRawAmount,
  legRates,
  phaseLabel,
  redeemOutputRaw,
  seriesPhase,
  type SeriesPhase,
} from "../lib/strip-math";
import { couponFromCum, MULTIPLIER_SCALE } from "../lib/markets";
import { CurveYtVaultPanel } from "./CurveYtVaultPanel";
import {
  CURVE_YT_CALLOUT,
  curveYtNonceLabel,
} from "../lib/curve-yt-labels";
import { marketPda, seriesPda } from "../lib/strip-tx";
import {
  buildYieldNonceMaturityMap,
  formatNonceMaturityLabel,
  formatYieldNonceWindowLabel,
  maturityForYieldNonce,
} from "../lib/yield-nonce-dates";
import type { CaListRow } from "../lib/xstocks-api";
import {
  DESK_LIVE_POLL_MS,
  shouldPollLiveState,
} from "../lib/live-poll";

export type LegHoldingRow = {
  yieldNonce: number;
  seriesExists: boolean;
  ptAmount: string;
  ytAmount: string;
  ptRaw: bigint;
  ytRaw: bigint;
};

type Props = {
  connection: Connection;
  symbol: string;
  mint: string;
  tipNonce: number;
  underlyingDecimals: number;
  legHoldings: LegHoldingRow[];
  legsLoading: boolean;
  verifiedLaunch: StoredLaunch | null;
  poolProgress: { quoteProgress: number; isMigrated: boolean } | null;
  marketDataReady?: boolean;
  busy: boolean;
  onRequestPool?: () => void;
  launchRegisteredOnChain?: boolean;
  onSelectInspect: (yieldNonce: number) => void;
  inspectNonce: number;
  fairCouponForNonce: (yieldNonce: number) => number;
  caRows?: CaListRow[];
  avgDistributionUsd?: number | null;
  rpcEndpoint: string;
  onDeskActivity?: () => void;
  /** Bumped after on-chain txs so curve progress + cum-Y stats refetch. */
  deskRefreshKey?: number;
  onTxConfirmed?: () => void | Promise<void>;
  onRedeemPt?: (yieldNonce: number, amountRaw: bigint) => void;
  onRedeemYt?: (yieldNonce: number, amountRaw: bigint) => void;
  /** Render only the inspect column or market band (used by unified desk layout). */
  part?: "all" | "core" | "market";
};

function LegStatusBadge({ phase }: { phase: SeriesPhase }) {
  return (
    <span className={`leg-phase leg-phase-${phase}`}>{phaseLabel(phase)}</span>
  );
}

export function StripInspectPanel({
  connection,
  symbol,
  mint,
  tipNonce,
  underlyingDecimals,
  legHoldings,
  legsLoading,
  verifiedLaunch,
  poolProgress,
  marketDataReady = true,
  busy,
  onRequestPool,
  launchRegisteredOnChain = false,
  onSelectInspect,
  inspectNonce,
  fairCouponForNonce,
  caRows = [],
  avgDistributionUsd,
  rpcEndpoint,
  onDeskActivity,
  deskRefreshKey = 0,
  onTxConfirmed,
  onRedeemPt,
  onRedeemYt,
  part = "all",
}: Props) {
  const [cumStart, setCumStart] = useState<bigint>(MULTIPLIER_SCALE);
  const [cumTarget, setCumTarget] = useState<bigint>(MULTIPLIER_SCALE);
  const [cumLoading, setCumLoading] = useState(false);
  const [vaultTick, setVaultTick] = useState(0);

  useEffect(() => {
    setVaultTick((t) => t + 1);
  }, [deskRefreshKey]);

  const phase = seriesPhase(tipNonce, inspectNonce);
  const fairCoupon = fairCouponForNonce(inspectNonce);
  const curvePreview = useMemo(
    () =>
      previewYtStripCurve(
        fairCoupon,
        avgDistributionUsd ?? undefined
      ),
    [fairCoupon, avgDistributionUsd]
  );
  const policyPreview = useMemo(() => {
    if (avgDistributionUsd == null || avgDistributionUsd <= 0) return null;
    return computeCurvePolicy({
      avgDistributionUsd,
      fairCoupon,
    });
  }, [avgDistributionUsd, fairCoupon]);
  const canRequestPool =
    marketDataReady &&
    avgDistributionUsd != null &&
    avgDistributionUsd > 0;
  const poolLive = Boolean(verifiedLaunch);

  const activeRow = legHoldings.find((r) => r.yieldNonce === inspectNonce);

  const rates = legRates(cumStart, cumTarget);
  const ptRedeemRaw = redeemOutputRaw(
    activeRow?.ptRaw ?? 0n,
    cumStart,
    cumTarget,
    true
  );
  const ytRedeemRaw = redeemOutputRaw(
    activeRow?.ytRaw ?? 0n,
    cumStart,
    cumTarget,
    false
  );

  const portfolioRows = legHoldings
    .filter((r) => r.seriesExists && (r.ptRaw > 0n || r.ytRaw > 0n))
    .sort((a, b) => b.yieldNonce - a.yieldNonce);

  const maturitySchedule = useMemo(
    () => buildYieldNonceMaturityMap(caRows),
    [caRows]
  );

  const maturityLabel = (nonce: number) =>
    formatNonceMaturityLabel(
      tipNonce,
      nonce,
      maturityForYieldNonce(maturitySchedule, nonce)
    );

  useEffect(() => {
    let cancelled = false;
    const loadCumYs = async (showLoading: boolean) => {
      if (!shouldPollLiveState()) return;
      if (showLoading) setCumLoading(true);
      try {
        const underlying = new PublicKey(mint);
        const marketKey = marketPda(underlying);
        const series = seriesPda(marketKey, inspectNonce);
        const seriesInfo = await connection.getAccountInfo(series);
        const cums = await fetchWindowCumYs(
          connection,
          underlying,
          inspectNonce,
          inspectNonce + 1,
          seriesInfo?.data ?? null
        );
        if (!cancelled) {
          setCumStart(cums.cumStart);
          setCumTarget(cums.cumTarget);
        }
      } catch {
        if (!cancelled) {
          setCumStart(MULTIPLIER_SCALE);
          setCumTarget(MULTIPLIER_SCALE);
        }
      } finally {
        if (!cancelled && showLoading) setCumLoading(false);
      }
    };

    void loadCumYs(true);
    const id = window.setInterval(
      () => void loadCumYs(false),
      DESK_LIVE_POLL_MS
    );
    const onVisible = () => {
      if (shouldPollLiveState()) void loadCumYs(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connection, mint, inspectNonce, deskRefreshKey]);

  const coreColumn = (
    <div className="desk-primary-inspect" aria-labelledby="inspect-heading">
      <header className="desk-card-head">
        <span className="desk-card-step" aria-hidden>
          2
        </span>
        <div>
          <h2 id="inspect-heading">Your positions</h2>
        </div>
      </header>

      <div className="desk-card-body desk-inspect-body">
        <div className="desk-block desk-block-compact">
          <div className="inspect-econ-slot">
            <div className="inspect-econ-head">
              <span className="inspect-window-range mono">
                {formatYieldNonceWindowLabel(inspectNonce, maturitySchedule)}
              </span>
              <LegStatusBadge phase={phase} />
              {activeRow ? (
                <span className="inspect-holdings mono">
                  PT {activeRow.ptAmount} · YT {activeRow.ytAmount}
                </span>
              ) : null}
            </div>
            {cumLoading ? (
              <dl
                className="inspect-econ-strip inspect-econ-strip-skeleton"
                aria-label="Loading rates"
              >
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <dt aria-hidden>&nbsp;</dt>
                    <dd className="desk-skeleton desk-skeleton-metric" aria-hidden />
                  </div>
                ))}
              </dl>
            ) : (
              <dl className="inspect-econ-strip">
                <div>
                  <dt>Capital (PT)</dt>
                  <dd className="mono">{(rates.ptShare * 100).toFixed(2)}%</dd>
                </div>
                <div>
                  <dt>Coupon (YT)</dt>
                  <dd className="mono">{(rates.ytShare * 100).toFixed(2)}%</dd>
                </div>
                <div>
                  <dt>Fair coupon</dt>
                  <dd className="mono">
                    {(
                      (couponFromCum(cumStart, cumTarget) || fairCoupon) *
                      100
                    ).toFixed(2)}
                    %
                  </dd>
                </div>
                {phase === "mature" && activeRow ? (
                  <>
                    <div>
                      <dt>PT redeem</dt>
                      <dd className="mono">
                        {formatRawAmount(ptRedeemRaw, underlyingDecimals)}{" "}
                        {symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>YT redeem</dt>
                      <dd className="mono">
                        {formatRawAmount(ytRedeemRaw, underlyingDecimals)}{" "}
                        {symbol}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            )}
          </div>

          {legsLoading ? (
            <div
              className="desk-skeleton inspect-positions-skeleton"
              aria-label="Loading positions"
            />
          ) : portfolioRows.length > 0 ? (
            <div className="desk-field">
              <span className="desk-field-label">All positions</span>
              <ul
                className="inspect-positions-list"
                aria-label="Your strip positions"
              >
                {portfolioRows.map((row) => {
                  const rowPhase = seriesPhase(tipNonce, row.yieldNonce);
                  const dateLabel = maturityLabel(row.yieldNonce);
                  const selected = row.yieldNonce === inspectNonce;
                  return (
                    <li key={row.yieldNonce}>
                      <button
                        type="button"
                        className={`inspect-position-row${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => onSelectInspect(row.yieldNonce)}
                      >
                        <span className="inspect-position-main">
                          <span className="inspect-position-nonce mono">
                            {formatYieldNonceWindowLabel(
                              row.yieldNonce,
                              maturitySchedule
                            )}
                          </span>
                          <LegStatusBadge phase={rowPhase} />
                        </span>
                        <span className="inspect-position-meta mono">
                          PT {row.ptAmount} · YT {row.ytAmount}
                          {dateLabel ? ` · ${dateLabel}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="hint inspect-empty">
              No strip positions for {symbol} yet. Split {symbol} to mint PT +
              YT.
            </p>
          )}

          {activeRow?.seriesExists && phase === "mature" ? (
            <div className="inspect-actions">
              <p className="inspect-actions-label">Redeem legs</p>
              <div className="inspect-redeem-row">
                {activeRow.ptRaw > 0n ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm inspect-action-btn"
                    disabled={busy || !onRedeemPt}
                    onClick={() =>
                      onRedeemPt?.(inspectNonce, activeRow.ptRaw)
                    }
                  >
                    Redeem PT →{" "}
                    {formatRawAmount(ptRedeemRaw, underlyingDecimals)} {symbol}
                  </button>
                ) : null}
                {activeRow.ytRaw > 0n ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm inspect-action-btn"
                    disabled={busy || !onRedeemYt}
                    onClick={() =>
                      onRedeemYt?.(inspectNonce, activeRow.ytRaw)
                    }
                  >
                    Redeem YT →{" "}
                    {formatRawAmount(ytRedeemRaw, underlyingDecimals)} {symbol}
                  </button>
                ) : null}
              </div>
            </div>
          ) : activeRow?.seriesExists &&
            (activeRow.ptRaw > 0n || activeRow.ytRaw > 0n) ? (
            <p className="hint inspect-redeem-hint">
              Unwrap early in the split panel (equal PT + YT). Redeem unlocks at
              maturity.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );

  const marketBand = (
    <section
      className="desk-card desk-card-market"
      aria-labelledby="market-heading"
    >
      <header className="desk-card-head">
        <span className="desk-card-step" aria-hidden>
          3
        </span>
        <div className="desk-card-head-text">
          <h2 id="market-heading">curve-YT market</h2>
          <p className="desk-card-sub" title={CURVE_YT_CALLOUT}>
            Meteora DBC ·{" "}
            <span className="mono">{curveYtNonceLabel(symbol, inspectNonce)}</span>{" "}
            · pool token for USDC price discovery, not strip YT
          </p>
        </div>
      </header>
      <div className="desk-card-body desk-market-body">
      <div className="desk-market-grid">
        <div className="desk-market-chart">
          <CurvePolicyBand
            compact
            placeholder={!poolLive}
            avgDistributionUsd={poolLive ? avgDistributionUsd : undefined}
            fairCoupon={fairCoupon}
            initialMcap={verifiedLaunch?.initialMarketCap}
            migrationMcap={verifiedLaunch?.migrationMarketCap}
            progressPct={
              poolLive && poolProgress
                ? poolProgress.quoteProgress * 100
                : null
            }
            isMigrated={poolLive ? (poolProgress?.isMigrated ?? false) : false}
          />
          <DbcCurveChart
            compact
            placeholder={!poolLive}
            fairCoupon={fairCoupon}
            avgDistributionUsd={poolLive ? avgDistributionUsd : undefined}
            fairMarketCapUsd={
              poolLive ? (policyPreview?.fairMarketCapUsd ?? null) : null
            }
            initialMcap={
              verifiedLaunch?.initialMarketCap ?? curvePreview.initialMarketCap
            }
            migrationMcap={
              verifiedLaunch?.migrationMarketCap ??
              curvePreview.migrationMarketCap
            }
            progressPct={
              poolLive && poolProgress
                ? poolProgress.quoteProgress * 100
                : null
            }
          />
        </div>
        <div className="desk-market-trade">
          {verifiedLaunch ? (
            <DbcPoolPanel
              key={`${symbol}-${verifiedLaunch.pool}`}
              connection={connection}
              rpcEndpoint={rpcEndpoint}
              pool={verifiedLaunch.pool}
              symbol={symbol}
              yieldNonce={launchYieldNonce(verifiedLaunch)}
              underlyingMint={mint}
              baseMint={verifiedLaunch.baseMint}
              quoteMint={verifiedLaunch.quoteMint}
              vaultRefreshKey={vaultTick}
              onActivityLogged={onDeskActivity}
              onVaultRefresh={() => setVaultTick((t) => t + 1)}
              onTxConfirmed={onTxConfirmed}
            />
          ) : (
            <div className="inspect-meteora-empty">
              <p className="hint">
                No curve-YT pool for{" "}
                {curveYtNonceLabel(symbol, inspectNonce)}.
              </p>
              {launchRegisteredOnChain ? (
                <p className="hint">
                  Pool registered on-chain — refresh or check Surfpool if the
                  desk panel is empty.
                </p>
              ) : null}
              <div className="inspect-meteora-actions">
                {marketDataReady && !canRequestPool ? (
                  <p className="hint curve-yt-launch-block">
                    Launch requires xStocks <strong>CashDividend</strong> history
                    to price the curve (avg $/share). Try another symbol or wait
                    for dividend data.
                  </p>
                ) : null}
                {onRequestPool ? (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy || !canRequestPool}
                    onClick={onRequestPool}
                    type="button"
                  >
                    {busy ? "Launching…" : "Request curve-YT pool"}
                  </button>
                ) : null}
                <p className="hint inspect-meteora-auth-hint">
                  Pool launch (server): Meteora DBC + register + curve-YT vault.
                  Requires ca_registry seeded by ./scripts/deploy-surfpool.sh.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
        {verifiedLaunch ? (
          <section
            className="desk-subsection"
            aria-labelledby="vault-heading"
          >
            <h3 id="vault-heading" className="desk-subsection-title">
              Vault &amp; strip exit
            </h3>
            <CurveYtVaultPanel
              key={`${symbol}-${verifiedLaunch.pool}-vault`}
              connection={connection}
              rpcEndpoint={rpcEndpoint}
              pool={verifiedLaunch.pool}
              curveYtMint={verifiedLaunch.baseMint}
              symbol={symbol}
              yieldNonce={launchYieldNonce(verifiedLaunch)}
              underlyingMint={mint}
              stripYtRaw={activeRow?.ytRaw ?? 0n}
              fairCoupon={fairCoupon}
              launchFairCoupon={verifiedLaunch.fairCoupon}
              vaultRefreshKey={vaultTick}
              onVaultRefresh={() => setVaultTick((t) => t + 1)}
              onActivityLogged={onDeskActivity}
              onTxConfirmed={onTxConfirmed}
            />
          </section>
        ) : null}
      </div>
    </section>
  );

  if (part === "core") return coreColumn;
  if (part === "market") return marketBand;
  return (
    <>
      {coreColumn}
      {marketBand}
    </>
  );
}
