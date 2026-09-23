import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import {
  DBC_BASE_DECIMALS,
  formatDbcAmount,
  quoteDbcSwapExactIn,
} from "../lib/dbc-pool-desk";
import {
  fetchCurveYtVaultMetrics,
  quoteStripYtForCurveYtAtSpot,
  type CurveYtVaultMetrics,
  type StripExitQuote,
} from "../lib/curve-yt-vault";
import { CurveYtVaultSummary } from "./CurveYtVaultSummary";
import {
  buildStripExitTransaction,
  buildSwapStripForCurveTransaction,
} from "../lib/strip-vault-tx";
import { appendDeskActivity } from "../lib/desk-activity";
import { sendTransactionChecked } from "../lib/wallet-tx";
import { formatTxError } from "../lib/tx-error";
import { curveYtTicker, lcYtTicker } from "../lib/curve-yt-labels";
import { QUOTE_SYMBOL } from "../lib/meteora-dbc";
import type { StripSeriesRef } from "../lib/strip-tx";
import {
  DESK_LIVE_POLL_MS,
  shouldPollLiveState,
} from "../lib/live-poll";

type Props = {
  connection: Connection;
  rpcEndpoint: string;
  pool: string;
  curveYtMint: string;
  symbol: string;
  yieldNonce: number;
  underlyingMint: string;
  stripYtRaw: bigint;
  fairCoupon: number;
  launchFairCoupon: number;
  onActivityLogged?: () => void;
  onVaultRefresh?: () => void;
  onTxConfirmed?: () => void | Promise<void>;
  vaultRefreshKey?: number;
};

function formatLegRaw(raw: bigint, decimals = DBC_BASE_DECIMALS): string {
  return formatDbcAmount(new BN(raw.toString()), false);
}

export function CurveYtVaultPanel({
  connection,
  pool,
  curveYtMint,
  symbol,
  yieldNonce,
  underlyingMint,
  stripYtRaw,
  fairCoupon,
  launchFairCoupon,
  onActivityLogged,
  onVaultRefresh,
  onTxConfirmed,
  vaultRefreshKey = 0,
}: Props) {
  const wallet = useWallet();
  const curveTicker = curveYtTicker(symbol);
  const lcTicker = lcYtTicker(symbol);
  const [metrics, setMetrics] = useState<CurveYtVaultMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [exitAmountUi, setExitAmountUi] = useState("");
  const [quote, setQuote] = useState<StripExitQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const seriesRef = useMemo<StripSeriesRef>(
    () => ({
      underlyingMint: new PublicKey(underlyingMint),
      yieldNonce,
    }),
    [underlyingMint, yieldNonce]
  );

  const exitAmountRaw = parseUiRaw(exitAmountUi);

  const refreshMetrics = useCallback(async () => {
    try {
      const pk = wallet.publicKey ?? PublicKey.default;
      const m = await fetchCurveYtVaultMetrics(
        connection,
        seriesRef,
        new PublicKey(curveYtMint),
        pool,
        pk,
        fairCoupon,
        launchFairCoupon
      );
      setMetrics((prev) => ({
        ...m,
        pool: m.pool ?? prev?.pool ?? null,
        poolQuoteReserveUi:
          m.pool?.quoteReserveUi ?? prev?.poolQuoteReserveUi ?? m.poolQuoteReserveUi,
        poolBaseReserveUi:
          m.pool?.baseReserveUi ?? prev?.poolBaseReserveUi ?? m.poolBaseReserveUi,
        quoteProgressPct:
          m.quoteProgressPct ?? prev?.quoteProgressPct ?? null,
        spotQuotePerCurveYt:
          m.spotQuotePerCurveYt ?? prev?.spotQuotePerCurveYt ?? null,
      }));
    } catch (e) {
      setStatus(formatTxError(e));
    } finally {
      setMetricsLoading(false);
    }
  }, [
    connection,
    seriesRef,
    curveYtMint,
    pool,
    wallet.publicKey,
    fairCoupon,
    launchFairCoupon,
  ]);

  useEffect(() => {
    void refreshMetrics();
  }, [refreshMetrics, vaultRefreshKey]);

  useEffect(() => {
    const tick = () => {
      if (shouldPollLiveState()) void refreshMetrics();
    };
    tick();
    const id = globalThis.setInterval(tick, DESK_LIVE_POLL_MS);
    const onVisible = () => {
      if (shouldPollLiveState()) void refreshMetrics();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      globalThis.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshMetrics]);

  const refreshQuote = useCallback(async () => {
    if (exitAmountRaw === 0n) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    try {
      const q = await quoteStripYtForCurveYtAtSpot(
        connection,
        pool,
        new BN(exitAmountRaw.toString()),
        fairCoupon,
        launchFairCoupon
      );
      setQuote(q);
      setQuoteError(q ? null : "Pool quote unavailable");
    } catch (e) {
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : "Quote failed");
    }
  }, [exitAmountRaw, connection, pool, fairCoupon, launchFairCoupon]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const afterTx = async () => {
    onActivityLogged?.();
    onVaultRefresh?.();
    await refreshMetrics();
    await onTxConfirmed?.();
  };

  const runStripExit = async (andSell: boolean) => {
    if (!wallet.publicKey || !quote || exitAmountRaw === 0n) return;
    setBusy(true);
    setStatus(null);
    try {
      let tx;
      if (andSell) {
        const curveUi = formatDbcAmount(quote.curveYtOut, false);
        const sellQuote = await quoteDbcSwapExactIn(
          connection,
          pool,
          curveUi,
          true,
          100
        );
        if (!sellQuote) throw new Error("Sell quote failed");
        tx = await buildStripExitTransaction(
          connection,
          wallet.publicKey,
          seriesRef,
          new PublicKey(curveYtMint),
          pool,
          exitAmountRaw,
          BigInt(quote.curveYtOut.toString()),
          BigInt(quote.minCurveYtOut.toString()),
          sellQuote
        );
      } else {
        tx = await buildSwapStripForCurveTransaction(
          connection,
          wallet.publicKey,
          seriesRef,
          new PublicKey(curveYtMint),
          exitAmountRaw,
          BigInt(quote.curveYtOut.toString()),
          BigInt(quote.minCurveYtOut.toString())
        );
      }
      const sig = await sendTransactionChecked(connection, tx, wallet, {
        modalLabel: andSell ? "strip exit to USDC" : "swap strip for curve-YT",
      });
      appendDeskActivity({
        kind: "dbc_swap",
        symbol,
        yieldNonce,
        at: Date.now(),
        signature: sig,
        amount: exitAmountUi,
        swapSide: "sell",
      });
      setStatus(
        andSell
          ? `Exited to ${QUOTE_SYMBOL} · ${sig.slice(0, 8)}…`
          : `Swapped to ${curveTicker} · ${sig.slice(0, 8)}…`
      );
      await afterTx();
    } catch (e) {
      setStatus(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const canExit =
    metrics?.initialized &&
    metrics.vaultCurveYtRaw > 0n &&
    stripYtRaw > 0n &&
    !metrics.isMigrated;

  return (
    <div className="curve-vault-panel">
      <p className="hint curve-vault-lead">
        <strong>Bonders</strong> fund the vault with{" "}
        <strong>Buy via vault</strong> and receive {lcTicker}.{" "}
        <strong>Splitters</strong> swap strip YT for {curveTicker} at spot,
        then sell for {QUOTE_SYMBOL}.
      </p>

      <CurveYtVaultSummary
        metrics={metrics}
        loading={metricsLoading && !metrics}
      />

      {metrics?.loadError ? (
        <p className="hint curve-vault-quote-error">{metrics.loadError}</p>
      ) : null}

      {metrics?.vaultExists && !metrics.curveMintMatch ? (
        <p className="hint curve-vault-quote-error">
          Curve-YT vault on this series is linked to a different curve-YT mint.
          Reset Surfpool or relaunch the pool for n{yieldNonce}.
        </p>
      ) : null}

      {!metrics?.initialized && !metrics?.vaultExists ? (
        <p className="hint curve-vault-empty">
          Vault is created automatically when you launch the curve-YT pool.
        </p>
      ) : metrics?.initialized ? (
        <section className="curve-vault-section">
          <h5 className="curve-vault-section-title">
            Exit strip YT → {QUOTE_SYMBOL}
          </h5>
          {stripYtRaw === 0n ? (
            <p className="hint curve-vault-empty">
              Split xStock first to mint strip YT for n{yieldNonce}.
            </p>
          ) : (
            <>
              <label className="desk-field">
                <span className="desk-field-row">
                  <span className="desk-field-label">strip YT amount</span>
                  <span className="desk-field-aside mono">
                    Bal {formatLegRaw(stripYtRaw)}
                  </span>
                </span>
                <input
                  className="desk-input mono"
                  inputMode="decimal"
                  placeholder={`max ${formatLegRaw(stripYtRaw)}`}
                  value={exitAmountUi}
                  onChange={(e) => setExitAmountUi(e.target.value)}
                />
              </label>
              {quote ? (
                <div className="curve-vault-quote">
                  <p>
                    Spot → ~{formatDbcAmount(quote.curveYtOut, false)}{" "}
                    {curveTicker}
                  </p>
                  <p className="hint">
                    Implied {QUOTE_SYMBOL}: {quote.impliedQuoteValue} · fair adj{" "}
                    {quote.fairMultiplier.toFixed(3)}×
                  </p>
                  <p className="hint">
                    Min out: {formatDbcAmount(quote.minCurveYtOut, false)}{" "}
                    (1% slippage)
                  </p>
                </div>
              ) : quoteError ? (
                <p className="hint curve-vault-quote-error">{quoteError}</p>
              ) : null}
              <div className="curve-vault-actions">
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy || !quote || !canExit}
                  onClick={() => void runStripExit(false)}
                  type="button"
                >
                  Swap for curve-YT
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy || !quote || !canExit}
                  onClick={() => void runStripExit(true)}
                  type="button"
                >
                  Exit to {QUOTE_SYMBOL}
                </button>
              </div>
            </>
          )}
        </section>
      ) : metricsLoading ? (
        <p className="hint">Loading vault metrics…</p>
      ) : null}

      {status ? <p className="hint curve-vault-status">{status}</p> : null}
    </div>
  );
}

function parseUiRaw(amountUi: string): bigint {
  const trimmed = amountUi.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) return 0n;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > DBC_BASE_DECIMALS) return 0n;
  const padded = `${whole || "0"}${frac.padEnd(DBC_BASE_DECIMALS, "0")}`;
  try {
    return BigInt(padded.replace(/^0+/, "") || "0");
  } catch {
    return 0n;
  }
}
