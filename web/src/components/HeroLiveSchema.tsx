"use client";

import { useMemo, useState } from "react";
import { MARKETS, MULTIPLIER_SCALE, couponFromCum } from "../lib/markets";
import {
  formatRawAmount,
  legRates,
  redeemOutputRaw,
  uiAmountToRaw,
} from "../lib/strip-math";

const HERO_SYMBOL = "KOx";
const WINDOW_LABEL = "September Dividends";
/** cum_y at window open (before the September coupon). */
const CUM_START_UI = "1.020000";
const UNDERLYING_DECIMALS = 8;
const DEMO_LEG_UI = "1.00";

function cumUiToRaw(ui: string): bigint {
  const [whole, frac = ""] = ui.split(".");
  const padded = frac.padEnd(12, "0").slice(0, 12);
  return BigInt(whole || "0") * MULTIPLIER_SCALE + BigInt(padded || "0");
}

function cumRawToUi(raw: bigint): string {
  const whole = raw / MULTIPLIER_SCALE;
  const frac = (raw % MULTIPLIER_SCALE).toString().padStart(12, "0");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

/** Add hypothetical dividend bps on top of cum_y start. */
function cumTargetFromDivBps(cumStart: bigint, divBps: number): bigint {
  return cumStart + (cumStart * BigInt(divBps)) / 10_000n;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function HeroLiveSchema() {
  const cumStart = useMemo(() => cumUiToRaw(CUM_START_UI), []);
  const [divBps, setDivBps] = useState(224);

  const cumTarget = useMemo(
    () => cumTargetFromDivBps(cumStart, divBps),
    [cumStart, divBps]
  );
  const { ptShare, ytShare } = legRates(cumStart, cumTarget);
  const fairCoupon = couponFromCum(cumStart, cumTarget);
  const legRaw = uiAmountToRaw(DEMO_LEG_UI, UNDERLYING_DECIMALS);
  const ptRedeemRaw = redeemOutputRaw(legRaw, cumStart, cumTarget, true);
  const ytRedeemRaw = redeemOutputRaw(legRaw, cumStart, cumTarget, false);
  const totalRedeemRaw = ptRedeemRaw + ytRedeemRaw;

  const cumStartUi = cumRawToUi(cumStart);
  const cumTargetUi = cumRawToUi(cumTarget);

  return (
    <div className="hero-stage">
      <div className="hero-stage-frame">
        <div className="hs-top">
          <span className="hs-live">
            <i /> LIVE SCHEMA
          </span>
          <span className="hs-meta">
            {HERO_SYMBOL} · {WINDOW_LABEL}
          </span>
        </div>

        <div className="hs-stack">
          <div className="hs-node hs-in">
            <span className="hs-k">UNDERLYING</span>
            <div className="hs-node-main">
              <strong>xStock</strong>
              <span className="hs-v">{DEMO_LEG_UI}</span>
            </div>
          </div>

          <div className="hs-beam">
            <span />
            <span />
            <span />
          </div>

          <div className="hs-split">
            <div className="hs-node hs-pt">
              <span className="hs-k">PRINCIPAL</span>
              <div className="hs-node-main">
                <strong>PT</strong>
                <span className="hs-v">{pct(ptShare)}</span>
              </div>
              <span className="hs-formula">Yₛ / Yₜ</span>
              <div className="hs-bar">
                <i style={{ width: `${Math.round(ptShare * 100)}%` }} />
              </div>
            </div>
            <div className="hs-node hs-yt">
              <span className="hs-k">YIELD</span>
              <div className="hs-node-main">
                <strong>YT</strong>
                <span className="hs-v">{pct(ytShare)}</span>
              </div>
              <span className="hs-formula">1 − Yₛ / Yₜ</span>
              <div className="hs-bar">
                <i style={{ width: `${Math.round(ytShare * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="hs-tool">
          <div className="hs-tool-head">
            <label htmlFor="hs-div-slider">September dividend size</label>
            <span className="hs-tool-value mono">
              +{(divBps / 100).toFixed(2)}% on cum_y
            </span>
          </div>
          <input
            id="hs-div-slider"
            className="hs-slider"
            type="range"
            min={0}
            max={350}
            step={1}
            value={divBps}
            onChange={(e) => setDivBps(Number(e.target.value))}
            aria-valuemin={0}
            aria-valuemax={350}
            aria-valuenow={divBps}
            aria-valuetext={`${(divBps / 100).toFixed(2)} percent dividend shock`}
          />
          <p className="hs-tool-hint">
            Drag to stress the September coupon — PT / YT split and raw redeem
            amounts update live.
          </p>

          <dl className="hs-raw-grid">
            <div>
              <dt>cum_y start → end</dt>
              <dd className="mono">
                {cumStartUi} → {cumTargetUi}
              </dd>
            </div>
            <div>
              <dt>{DEMO_LEG_UI} PT → xStock raw</dt>
              <dd className="mono">{ptRedeemRaw.toString()}</dd>
            </div>
            <div>
              <dt>{DEMO_LEG_UI} YT → xStock raw</dt>
              <dd className="mono">{ytRedeemRaw.toString()}</dd>
            </div>
            <div>
              <dt>Pair total raw</dt>
              <dd className="mono">
                {totalRedeemRaw.toString()}
                <span className="hs-raw-ui">
                  {" "}
                  ≈ {formatRawAmount(totalRedeemRaw, UNDERLYING_DECIMALS)} xStock
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="hs-footer">
          <div>
            <span className="hs-k">FAIR COUPON</span>
            <strong>{pct(fairCoupon)}</strong>
          </div>
          <div>
            <span className="hs-k">VENUE</span>
            <strong>DBC → DAMM</strong>
          </div>
          <div>
            <span className="hs-k">DESK</span>
            <strong>{MARKETS.length} mkts</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
