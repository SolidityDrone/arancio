import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  buildDbcSwapTransaction,
  DBC_BASE_DECIMALS,
  DBC_QUOTE_DECIMALS,
  fetchDbcPoolSnapshot,
  formatDbcAmount,
  isLocalRpc,
  quoteDbcSwapExactIn,
  type DbcPoolSnapshot,
  type DbcSwapQuote,
} from "../lib/dbc-pool-desk";
import { sendTransactionChecked } from "../lib/wallet-tx";
import { formatSimHint } from "../lib/tx-preview";

type Props = {
  connection: Connection;
  rpcEndpoint: string;
  pool: string;
  baseMint?: string;
  quoteMint?: string;
  ytSymbol?: string;
};

export function DbcPoolPanel({
  connection,
  rpcEndpoint,
  pool,
  ytSymbol = "YT",
}: Props) {
  const wallet = useWallet();
  const local = isLocalRpc(rpcEndpoint);

  const [snapshot, setSnapshot] = useState<DbcPoolSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.01");
  const [quote, setQuote] = useState<DbcSwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await fetchDbcPoolSnapshot(connection, pool);
      setSnapshot(snap);
    } finally {
      setLoading(false);
    }
  }, [connection, pool]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const onSwap = async () => {
    if (!wallet.publicKey || !wallet.sendTransaction || !quote || !snapshot) {
      setStatus("Connect wallet to swap on the local curve.");
      return;
    }
    if (snapshot.isMigrated) {
      setStatus("Pool migrated — DBC swaps are closed.");
      return;
    }
    setBusy(true);
    setStatus("Building swap…");
    try {
      const tx = await buildDbcSwapTransaction(
        connection,
        wallet.publicKey,
        pool,
        quote
      );
      const sig = await sendTransactionChecked(connection, tx, wallet, {
        beforeWallet: (sim) =>
          setStatus(`${formatSimHint(sim)} · confirm swap in wallet`),
      });
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`Swap confirmed · ${sig.slice(0, 10)}…`);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Swap failed");
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
  const inputSymbol = side === "buy" ? "SOL" : ytSymbol;
  const outputSymbol = side === "buy" ? ytSymbol : "SOL";
  const inputDecimals = side === "buy" ? DBC_QUOTE_DECIMALS : DBC_BASE_DECIMALS;

  return (
    <div className="dbc-pool-panel">
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
          <dt>YT in vault</dt>
          <dd className="mono">{snapshot.baseReserveUi}</dd>
        </div>
        <div>
          <dt>SOL in vault</dt>
          <dd className="mono">{snapshot.quoteReserveUi}</dd>
        </div>
      </dl>

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
              Buy {ytSymbol}
            </button>
            <button
              type="button"
              className={side === "sell" ? "active" : ""}
              onClick={() => setSide("sell")}
            >
              Sell {ytSymbol}
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
                disabled={busy || !quote || !wallet.publicKey}
                onClick={onSwap}
              >
                {busy ? "Swapping…" : "Swap on curve"}
              </button>
            </div>
            {quote ? (
              <p className="hint dbc-swap-quote">
                ≈ {formatDbcAmount(quote.outputAmount, side === "sell")}{" "}
                {outputSymbol}
                <span className="dbc-swap-min">
                  {" "}
                  (min {formatDbcAmount(quote.minimumAmountOut, side === "sell")})
                </span>
              </p>
            ) : quoteError ? (
              <p className="hint dbc-swap-quote">{quoteError}</p>
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
