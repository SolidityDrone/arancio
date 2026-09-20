import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { DEFAULT_QUOTE_MINT, QUOTE_SYMBOL } from "../lib/meteora-dbc";
import {
  DBC_BASE_DECIMALS,
  fetchDbcPoolSnapshot,
  formatDbcAmountCompact,
  isLocalRpc,
  quoteDbcSwapExactIn,
  rawDbcToUiNumber,
  type DbcPoolSnapshot,
  type DbcSwapQuote,
} from "../lib/dbc-pool-desk";
import { fetchTokenBalance } from "../lib/spl-balance";
import { appendDeskActivity } from "../lib/desk-activity";
import { sendTransactionChecked } from "../lib/wallet-tx";
import { formatTxError } from "../lib/tx-error";
import { formatSimHint } from "../lib/tx-preview";
import {
  CURVE_YT_CALLOUT,
  curveYtTicker,
  curveYtWindowLabel,
  lcYtTicker,
} from "../lib/curve-yt-labels";
import {
  buildPrepareAndInitVaultTransaction,
  buildVaultBuyTransaction,
  buildVaultSellTransaction,
  fetchCurveYtVaultState,
  fetchCurveYtVaultStateForWallet,
} from "../lib/strip-vault-tx";
import type { StripWindow } from "../lib/strip-tx";

type Props = {
  connection: Connection;
  rpcEndpoint: string;
  pool: string;
  symbol: string;
  startNonce: number;
  targetNonce: number;
  underlyingMint: string;
  baseMint: string;
  quoteMint?: string;
  onActivityLogged?: () => void;
  onVaultRefresh?: () => void;
  vaultRefreshKey?: number;
};

export function DbcPoolPanel({
  connection,
  rpcEndpoint,
  pool,
  symbol,
  startNonce,
  targetNonce,
  underlyingMint,
  baseMint,
  quoteMint,
  onActivityLogged,
  onVaultRefresh,
  vaultRefreshKey = 0,
}: Props) {
  const curveTicker = curveYtTicker(symbol);
  const lcTicker = lcYtTicker(symbol);
  const curveLabel = curveYtWindowLabel(symbol, startNonce, targetNonce);
  const wallet = useWallet();
  const local = isLocalRpc(rpcEndpoint);

  const stripWindow = useMemo<StripWindow>(
    () => ({
      underlyingMint: new PublicKey(underlyingMint),
      startNonce,
      targetNonce,
    }),
    [underlyingMint, startNonce, targetNonce]
  );

  const [snapshot, setSnapshot] = useState<DbcPoolSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [vaultReady, setVaultReady] = useState(false);
  const [vaultExists, setVaultExists] = useState(false);
  const [curveMintMatch, setCurveMintMatch] = useState(false);
  const [lcYtRaw, setLcYtRaw] = useState(0n);
  const [usdcUi, setUsdcUi] = useState<string | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<DbcSwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchDbcPoolSnapshot(connection, pool);
      if (snap) setSnapshot(snap);
    } finally {
      setLoading(false);
    }
  }, [connection, pool]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const quoteMintPk = useMemo(
    () => new PublicKey(quoteMint ?? DEFAULT_QUOTE_MINT.toBase58()),
    [quoteMint]
  );

  const refreshVault = useCallback(async () => {
    const curveMint = new PublicKey(baseMint);
    const base = await fetchCurveYtVaultState(connection, stripWindow, curveMint);
    setVaultReady(base.initialized);
    setVaultExists(base.vaultExists);
    setCurveMintMatch(base.curveMintMatch);
    if (wallet.publicKey) {
      const usdc = await fetchTokenBalance(
        connection,
        quoteMintPk,
        wallet.publicKey
      );
      setUsdcUi(usdc.ui);
      if (base.initialized) {
        const ws = await fetchCurveYtVaultStateForWallet(
          connection,
          wallet.publicKey,
          stripWindow,
          curveMint
        );
        setLcYtRaw(ws.walletLcYtRaw);
      } else {
        setLcYtRaw(0n);
      }
    } else {
      setUsdcUi(null);
      setLcYtRaw(0n);
    }
  }, [connection, wallet.publicKey, stripWindow, baseMint, quoteMintPk]);

  useEffect(() => {
    void refreshVault();
  }, [refreshVault, vaultRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!snapshot || snapshot.isMigrated || !amount.trim()) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const swapBaseForQuote = side === "sell";
        const q = await quoteDbcSwapExactIn(
          connection,
          pool,
          amount,
          swapBaseForQuote,
          100
        );
        if (cancelled) return;
        if (!q) {
          setQuote(null);
          setQuoteError("Enter a valid amount");
          return;
        }
        setQuote(q);
        setQuoteError(null);
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(e instanceof Error ? e.message : "Quote failed");
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [amount, side, connection, pool, snapshot]);

  const runInitVault = async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setStatus("Connect wallet to initialize the vault.");
      return;
    }
    setBusy(true);
    setStatus("Preparing curve-YT vault (market + series + vault)…");
    try {
      const tx = await buildPrepareAndInitVaultTransaction(
        connection,
        wallet.publicKey,
        stripWindow,
        new PublicKey(baseMint),
        symbol
      );
      const sig = await sendTransactionChecked(connection, tx, wallet, {
        modalLabel: "init vault",
      });
      onVaultRefresh?.();
      await refreshVault();
      setStatus(`Vault ready · ${sig.slice(0, 10)}… — you can buy now`);
    } catch (e) {
      setStatus(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onSwap = async () => {
    if (!wallet.publicKey || !wallet.sendTransaction || !quote || !snapshot) {
      setStatus("Connect wallet to swap on the local curve.");
      return;
    }
    if (snapshot.isMigrated) {
      setStatus("Pool migrated — DBC swaps are closed.");
      return;
    }
    if (!vaultReady) {
      setStatus("Initialize the curve-YT vault below before bonding.");
      return;
    }
    setBusy(true);
    setStatus("Building swap…");
    try {
      let tx;
      if (side === "buy") {
        setStatus("Vault proxy buy: curve → lcYT…");
        tx = await buildVaultBuyTransaction(
          connection,
          wallet.publicKey,
          stripWindow,
          new PublicKey(baseMint),
          pool,
          quote
        );
      } else {
        const sellRaw = BigInt(quote.amountIn.toString());
        if (lcYtRaw < sellRaw) {
          throw new Error(
            `Insufficient ${lcTicker} — redeem requires vault shares`
          );
        }
        setStatus("Vault proxy sell: lcYT → USDC…");
        tx = await buildVaultSellTransaction(
          connection,
          wallet.publicKey,
          stripWindow,
          new PublicKey(baseMint),
          pool,
          sellRaw,
          quote
        );
      }
      const sig = await sendTransactionChecked(connection, tx, wallet, {
        modalLabel: side === "buy" ? "vault buy" : "vault sell",
        beforeWallet: (sim) =>
          setStatus(`${formatSimHint(sim)} · confirm in wallet`),
      });
      appendDeskActivity({
        kind: "dbc_swap",
        symbol,
        startNonce,
        targetNonce,
        at: Date.now(),
        signature: sig,
        pool,
        amount: amount.trim(),
        amountSymbol:
          side === "buy" ? lcTicker : QUOTE_SYMBOL,
        swapSide: side,
      });
      onActivityLogged?.();
      onVaultRefresh?.();
      setStatus(
        side === "buy"
          ? `Vault buy · ${lcTicker} minted · ${sig.slice(0, 10)}…`
          : `Vault sell · ${sig.slice(0, 10)}…`
      );
      await refresh();
      await refreshVault();
    } catch (e) {
      setStatus(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !snapshot) {
    return <p className="hint dbc-pool-loading">Loading pool from Surfpool…</p>;
  }

  if (!snapshot) {
    return (
      <p className="hint">
        Pool account not found on this RPC — check Surfpool is running.
      </p>
    );
  }

  const progressPct = Math.round(snapshot.quoteProgress * 100);
  const inputSymbol = side === "buy" ? QUOTE_SYMBOL : lcTicker;
  const outputSymbol = side === "buy" ? lcTicker : QUOTE_SYMBOL;
  const lcYtUi = formatDbcAmountCompact(lcYtRaw, false);
  const poolCurveUi = formatDbcAmountCompact(snapshot.baseReserve, false);
  const poolUsdcUi = formatDbcAmountCompact(snapshot.quoteReserve, true);

  const quoteSpotLine =
    quote && amount.trim()
      ? (() => {
          const inUi = Number(amount.trim());
          const outUi = rawDbcToUiNumber(
            quote.outputAmount,
            side === "sell"
          );
          if (!Number.isFinite(inUi) || inUi <= 0 || outUi <= 0) return null;
          const usdcPerLc =
            side === "buy" ? inUi / outUi : outUi / inUi;
          return `~${usdcPerLc.toFixed(6)} ${QUOTE_SYMBOL} per ${lcTicker}`;
        })()
      : null;

  const swapBlockedReason = !wallet.publicKey
    ? "Connect wallet to buy via vault."
    : vaultExists && !curveMintMatch
      ? "Curve-YT vault on this window uses a different curve-YT mint — reset Surfpool or relaunch the pool."
      : !vaultReady
        ? "Initialize the vault first (button below)."
        : !quote
          ? quoteError ?? "Waiting for swap quote…"
          : null;

  return (
    <div className="dbc-pool-panel">
      <p className="curve-yt-callout">
        <span className="curve-yt-tag">curve-YT</span>{" "}
        <span className="mono">{curveLabel}</span>
        <span className="curve-yt-callout-detail">{CURVE_YT_CALLOUT}</span>
      </p>
      <dl className="dbc-pool-stats">
        <div>
          <dt>Phase</dt>
          <dd>
            {snapshot.isMigrated
              ? "DAMM v2 (graduated)"
              : `DBC bonding · ${progressPct}%`}
          </dd>
        </div>
        <div>
          <dt>Pool</dt>
          <dd>
            <code>{snapshot.pool.slice(0, 14)}…</code>
          </dd>
        </div>
        <div>
          <dt>Pool curve-YT</dt>
          <dd className="mono" title={snapshot.baseReserveUi}>
            {poolCurveUi}
          </dd>
        </div>
        <div>
          <dt>Pool {QUOTE_SYMBOL}</dt>
          <dd className="mono" title={snapshot.quoteReserveUi}>
            {poolUsdcUi}
          </dd>
        </div>
      </dl>

      {!vaultReady && !snapshot.isMigrated ? (
        <div className="dbc-vault-setup">
          <p className="hint dbc-vault-note">
            One-time setup: link this pool to the curve-YT vault, then USDC buys
            mint {lcTicker} 1:1.
          </p>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || !wallet.publicKey || (vaultExists && !curveMintMatch)}
            onClick={() => void runInitVault()}
          >
            {busy ? "Setting up…" : "Initialize vault for this pool"}
          </button>
        </div>
      ) : null}

      {snapshot.isMigrated ? (
        <div className="dbc-pool-migrated">
          <p className="hint">
            Bonding finished — curve trading is closed. Liquidity lives on the
            migrated DAMM v2 pool on this same RPC.
          </p>
          {snapshot.dammV2Pool ? (
            <p className="mono dbc-damm-addr">
              DAMM pool: {snapshot.dammV2Pool.slice(0, 20)}…
            </p>
          ) : null}
          <p className="hint dbc-local-note">
            {local
              ? "In-app DAMM swap coming next — for now inspect vault balances above or use Solscan on your tx."
              : "Open Meteora app for DAMM v2 swaps on mainnet."}
          </p>
        </div>
      ) : (
        <>
          <div className="dbc-swap-tabs">
            <button
              type="button"
              className={side === "buy" ? "active" : ""}
              onClick={() => setSide("buy")}
            >
              Buy via vault ({lcTicker})
            </button>
            <button
              type="button"
              className={side === "sell" ? "active" : ""}
              onClick={() => setSide("sell")}
            >
              Sell {lcTicker}
            </button>
          </div>
          <div className="dbc-swap-form">
            <span className="desk-field-label">
              Amount ({inputSymbol})
            </span>
            <div className="dbc-swap-input-row">
              <input
                className="desk-input mono dbc-swap-input"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={side === "buy" ? "0.01" : "100"}
                aria-label={`Swap amount in ${inputSymbol}`}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm dbc-swap-btn"
                disabled={busy || !quote || !wallet.publicKey || !vaultReady}
                onClick={onSwap}
              >
                {busy
                  ? "Submitting…"
                  : side === "buy"
                    ? `Buy · mint ${lcTicker}`
                    : `Sell · redeem ${lcTicker}`}
              </button>
            </div>
            {wallet.publicKey ? (
              <p className="hint dbc-wallet-balances">
                Your {QUOTE_SYMBOL}:{" "}
                <span className="mono">{usdcUi ?? "…"}</span>
                {vaultReady ? (
                  <>
                    {" · "}
                    Your {lcTicker}:{" "}
                    <span className="mono">{lcYtUi}</span>
                  </>
                ) : null}
              </p>
            ) : null}
            {quote ? (
              <>
                <p className="hint dbc-swap-quote">
                  ≈{" "}
                  {formatDbcAmountCompact(
                    quote.outputAmount,
                    side === "sell"
                  )}{" "}
                  {outputSymbol}
                  <span className="dbc-swap-min">
                    {" "}
                    (min{" "}
                    {formatDbcAmountCompact(
                      quote.minimumAmountOut,
                      side === "sell"
                    )}
                    )
                  </span>
                </p>
                {quoteSpotLine ? (
                  <p className="hint dbc-swap-spot">{quoteSpotLine}</p>
                ) : null}
                {side === "buy" && progressPct < 25 ? (
                  <p className="hint dbc-swap-curve-note">
                    Early bonding ({progressPct}% filled): the curve mints many{" "}
                    {lcTicker} per {QUOTE_SYMBOL}. Counts look huge but track
                    Meteora&apos;s 1B curve-YT supply — not a wallet bug.
                  </p>
                ) : null}
              </>
            ) : quoteError ? (
              <p className="hint dbc-swap-quote">{quoteError}</p>
            ) : null}
            {swapBlockedReason && !busy ? (
              <p className="hint dbc-swap-blocked">{swapBlockedReason}</p>
            ) : null}
          </div>
        </>
      )}

      <div className="dbc-pool-foot">
        {status ? <p className="hint dbc-pool-status">{status}</p> : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
