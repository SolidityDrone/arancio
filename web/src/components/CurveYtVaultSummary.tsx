import type { CurveYtVaultMetrics } from "../lib/curve-yt-vault";
import { QUOTE_SYMBOL } from "../lib/meteora-dbc";
import { DBC_BASE_DECIMALS } from "../lib/dbc-pool-desk";

type Props = {
  metrics: CurveYtVaultMetrics | null;
  loading?: boolean;
};

/** Human-readable token amount; flags absurd on-chain reads. */
export function formatTokenUi(raw: bigint, decimals: number): string {
  const ui = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(ui) || ui === 0) return "0";
  if (ui >= 1_000_000) {
    return `${(ui / 1_000_000).toFixed(2)}M`;
  }
  if (ui >= 10_000) {
    return `${(ui / 1_000).toFixed(1)}k`;
  }
  return ui.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function CurveYtVaultSummary({ metrics, loading }: Props) {
  if (loading && !metrics) {
    return (
      <p className="hint curve-vault-summary-loading">Loading vault snapshot…</p>
    );
  }
  if (!metrics) {
    return (
      <p className="hint curve-vault-summary-empty">
        Connect wallet and initialize the curve-YT vault to see liquidity.
      </p>
    );
  }

  const poolUsdc = metrics.pool?.quoteReserveUi ?? metrics.poolQuoteReserveUi;
  const poolCurve = metrics.pool?.baseReserveUi ?? metrics.poolBaseReserveUi;
  const vaultCurve = formatTokenUi(metrics.vaultCurveYtRaw, DBC_BASE_DECIMALS);
  const vaultStrip = formatTokenUi(metrics.vaultStripYtRaw, DBC_BASE_DECIMALS);
  const spot = metrics.spotQuotePerCurveYt;

  const poolUsdcN = Number(poolUsdc) || 0;
  const poolCurveN = Number(poolCurve) || 0;
  const reservesLookBroken =
    poolUsdcN > 0 && poolCurveN / poolUsdcN > 50_000;

  return (
    <div className="curve-vault-summary">
      <dl className="curve-vault-summary-grid">
        <div>
          <dt>Pool {QUOTE_SYMBOL}</dt>
          <dd className="mono">{poolUsdc}</dd>
        </div>
        <div>
          <dt>Pool curve-YT</dt>
          <dd className="mono">{poolCurve}</dd>
        </div>
        <div>
          <dt title="curve-YT available for splitter exits">Vault curve-YT</dt>
          <dd className="mono">{vaultCurve}</dd>
        </div>
        <div>
          <dt>Vault strip YT</dt>
          <dd className="mono">{vaultStrip}</dd>
        </div>
        <div>
          <dt>Spot {QUOTE_SYMBOL}/cYT</dt>
          <dd className="mono">
            {spot != null && spot > 0 ? spot.toFixed(6) : "—"}
          </dd>
        </div>
        <div>
          <dt>Pool progress</dt>
          <dd className="mono">
            {metrics.quoteProgressPct != null
              ? `${metrics.quoteProgressPct}%`
              : "—"}
          </dd>
        </div>
        <div>
          <dt title="Fair coupon now vs at launch">Fair adj</dt>
          <dd className="mono">{(metrics.fairMultiplier * 100).toFixed(1)}%</dd>
        </div>
        {metrics.vaultPda ? (
          <div>
            <dt>Vault PDA</dt>
            <dd className="mono">
              {metrics.vaultPda.slice(0, 6)}…{metrics.vaultPda.slice(-4)}
            </dd>
          </div>
        ) : null}
      </dl>

      {reservesLookBroken ? (
        <p className="hint curve-vault-summary-warn">
          Pool curve-YT vs {QUOTE_SYMBOL} looks off (likely a bad vault-buy
          deposit size). Reset Surfpool, relaunch the pool, and re-buy with a
          small USDC amount (e.g. 10–100 {QUOTE_SYMBOL}).
        </p>
      ) : null}

      {spot == null || spot <= 0 ? (
        <p className="hint curve-vault-summary-warn">
          Spot price unavailable — exit quotes in the form below may fail until
          the DBC pool has real trades.
        </p>
      ) : null}
    </div>
  );
}
