import { useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { DbcCurveChart } from "./DbcCurveChart";
import { buildYtStripCurve, type StoredLaunch } from "../lib/meteora-dbc";
import { DbcPoolPanel } from "./DbcPoolPanel";
import { DIVSTRIP_PROGRAM_ID } from "../lib/markets";
import { fetchWindowCumYs } from "../lib/registry-cum-y";
import {
  formatRawAmount,
  legRates,
  phaseLabel,
  redeemOutputRaw,
  windowPhase,
  type WindowPhase,
} from "../lib/strip-math";
import { couponFromCum, MULTIPLIER_SCALE } from "../lib/markets";

export type LegHoldingRow = {
  startNonce: number;
  targetNonce: number;
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
  busy: boolean;
  onLaunch: () => void;
  onSelectInspect: (start: number, target: number) => void;
  inspectStart: number;
  inspectTarget: number;
  inspectSource: "manual" | "portfolio";
  onInspectSourceChange: (source: "manual" | "portfolio") => void;
  onManualStartChange: (start: number) => void;
  onManualTargetChange: (target: number) => void;
  fairCouponForWindow: (start: number, target: number) => number;
  rpcEndpoint: string;
  /** Render only the inspect column or market band (used by unified desk layout). */
  part?: "all" | "core" | "market";
};

const MANUAL_SELECT = "manual";

function splitKey(start: number, target: number) {
  return `${start}:${target}`;
}

function LegStatusBadge({ phase }: { phase: WindowPhase }) {
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
  busy,
  onLaunch,
  onSelectInspect,
  inspectStart,
  inspectTarget,
  inspectSource,
  onInspectSourceChange,
  onManualStartChange,
  onManualTargetChange,
  fairCouponForWindow,
  rpcEndpoint,
  part = "all",
}: Props) {
  const [cumStart, setCumStart] = useState<bigint>(MULTIPLIER_SCALE);
  const [cumTarget, setCumTarget] = useState<bigint>(MULTIPLIER_SCALE);
  const [cumLoading, setCumLoading] = useState(false);

  const phase = windowPhase(tipNonce, inspectStart, inspectTarget);
  const fairCoupon = fairCouponForWindow(inspectStart, inspectTarget);
  const curvePreview = useMemo(
    () => buildYtStripCurve(fairCoupon),
    [fairCoupon]
  );

  const activeRow = legHoldings.find(
    (r) => r.startNonce === inspectStart && r.targetNonce === inspectTarget
  );

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

  const portfolioRows = legHoldings.filter(
    (r) => r.seriesExists && (r.ptRaw > 0n || r.ytRaw > 0n)
  );

  const currentSplitKey = splitKey(inspectStart, inspectTarget);
  const hasCurrentInPortfolio = portfolioRows.some(
    (r) => splitKey(r.startNonce, r.targetNonce) === currentSplitKey
  );
  const selectValue =
    inspectSource === "manual" || !hasCurrentInPortfolio
      ? MANUAL_SELECT
      : currentSplitKey;

  useEffect(() => {
    let cancelled = false;
    setCumLoading(true);
    (async () => {
      try {
        const underlying = new PublicKey(mint);
        const programId = new PublicKey(DIVSTRIP_PROGRAM_ID);
        const marketKey = PublicKey.findProgramAddressSync(
          [Buffer.from("strip"), underlying.toBuffer()],
          programId
        )[0];
        const startBuf = Buffer.alloc(4);
        startBuf.writeUInt32LE(inspectStart);
        const targetBuf = Buffer.alloc(4);
        targetBuf.writeUInt32LE(inspectTarget);
        const series = PublicKey.findProgramAddressSync(
          [
            Buffer.from("series"),
            marketKey.toBuffer(),
            startBuf,
            targetBuf,
          ],
          programId
        )[0];
        const seriesInfo = await connection.getAccountInfo(series);
        const cums = await fetchWindowCumYs(
          connection,
          underlying,
          inspectStart,
          inspectTarget,
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
        if (!cancelled) setCumLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, mint, inspectStart, inspectTarget]);

  const onWindowSelect = (value: string) => {
    if (value === MANUAL_SELECT) {
      onInspectSourceChange("manual");
      return;
    }
    const [start, target] = value.split(":").map(Number);
    if (Number.isFinite(start) && Number.isFinite(target)) {
      onSelectInspect(start, target);
    }
  };

  const coreColumn = (
    <div className="desk-primary-inspect" aria-labelledby="inspect-heading">
      <header className="desk-card-head">
        <span className="desk-card-step" aria-hidden>
          2
        </span>
        <div>
          <h2 id="inspect-heading">Inspect position</h2>
        </div>
      </header>

      <div className="desk-card-body desk-inspect-body">
        <div className="desk-block desk-block-compact">
          {legsLoading ? (
            <p className="hint">Loading splits…</p>
          ) : (
            <>
              <select
                className="desk-select mono desk-select-full"
                aria-label="Choose split window"
                value={selectValue}
                onChange={(e) => onWindowSelect(e.target.value)}
              >
                  {portfolioRows.length === 0 ? (
                    <option value={MANUAL_SELECT}>Custom range…</option>
                  ) : (
                    <>
                      {portfolioRows.map((row) => (
                        <option
                          key={splitKey(row.startNonce, row.targetNonce)}
                          value={splitKey(row.startNonce, row.targetNonce)}
                        >
                          n{row.startNonce}→n{row.targetNonce} · PT {row.ptAmount}{" "}
                          · YT {row.ytAmount}
                        </option>
                      ))}
                      <option value={MANUAL_SELECT}>Custom range…</option>
                    </>
                  )}
              </select>

              {inspectSource === "manual" && (
                <div className="inspect-manual-row">
                  <label className="desk-field desk-field-inline">
                    <span className="desk-field-label">Start nonce</span>
                    <input
                      className="desk-input mono"
                      type="number"
                      min={0}
                      value={inspectStart}
                      onChange={(e) =>
                        onManualStartChange(Number(e.target.value) || 0)
                      }
                    />
                  </label>
                  <label className="desk-field desk-field-inline">
                    <span className="desk-field-label">Maturity nonce</span>
                    <input
                      className="desk-input mono"
                      type="number"
                      min={inspectStart + 1}
                      value={inspectTarget}
                      onChange={(e) =>
                        onManualTargetChange(
                          Math.max(inspectStart + 1, Number(e.target.value) || 0)
                        )
                      }
                    />
                  </label>
                </div>
              )}
            </>
          )}

          <div className="inspect-window-summary">
            <span className="inspect-window-range mono">
              n{inspectStart} → n{inspectTarget}
            </span>
            <LegStatusBadge phase={phase} />
            {activeRow ? (
              <span className="inspect-holdings mono">
                PT {activeRow.ptAmount} · YT {activeRow.ytAmount}
              </span>
            ) : (
              <span className="hint inspect-no-position">No position</span>
            )}
          </div>

          {cumLoading ? (
            <p className="hint">Loading rates…</p>
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
      </div>
    </div>
  );

  const marketBand = (
    <div className="desk-market-row" aria-labelledby="market-heading">
      <h3 id="market-heading" className="desk-market-title">
        YT market · Meteora DBC
      </h3>
      <div className="inspect-market-grid">
          <DbcCurveChart
            compact
            fairCoupon={fairCoupon}
            initialMcap={curvePreview.initialMarketCap}
            migrationMcap={curvePreview.migrationMarketCap}
            progressPct={
              poolProgress ? poolProgress.quoteProgress * 100 : null
            }
          />
          <div className="inspect-meteora">
            {verifiedLaunch ? (
              <DbcPoolPanel
                connection={connection}
                rpcEndpoint={rpcEndpoint}
                pool={verifiedLaunch.pool}
                baseMint={verifiedLaunch.baseMint}
                quoteMint={verifiedLaunch.quoteMint}
                ytSymbol={`YT${symbol}`}
              />
            ) : (
              <div className="inspect-meteora-empty">
                <p className="hint">
                  No pool for n{inspectStart}→n{inspectTarget}. Split first,
                  then launch YT discovery.
                </p>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={onLaunch}
                  type="button"
                >
                  {busy ? "Initializing…" : "Launch Meteora DBC pool"}
                </button>
              </div>
            )}
          </div>
        </div>
    </div>
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
