import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import {
  DESK_LIVE_POLL_MS,
  shouldPollLiveState,
} from "../lib/live-poll";
import {
  isKaminoYieldBackend,
  KAMINO_CUSDC_MINT,
  KAMINO_QUOTE_SYMBOL,
  type KaminoRedeemPreview,
  type KaminoUsdcSnapshot,
} from "../lib/kamino-usdc-config";
import {
  fetchKaminoUsdcSnapshotBrowser,
  previewKaminoRedeemBrowser,
} from "../lib/kamino-usdc-browser";

type Props = {
  connection: Connection;
  rpcEndpoint: string;
  /** Wallet to preview; omit for market-wide rate only. */
  wallet?: PublicKey | null;
  /** Optional: vault cUSDC ATA owner for inventory preview. */
  inventoryOwner?: PublicKey | null;
  refreshKey?: number;
};

function fmtUsdc(raw: bigint, digits = 4): string {
  const n = Number(raw) / 1e6;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

function fmtApy(apy: number): string {
  if (!Number.isFinite(apy)) return "—";
  return `${(apy * 100).toFixed(2)}%`;
}

/**
 * Compact Kamino reserve readout for vault parking (not the curve buy path).
 */
export function KaminoYieldPanel({
  connection,
  rpcEndpoint: _rpcEndpoint,
  wallet,
  inventoryOwner,
  refreshKey = 0,
}: Props) {
  const [snap, setSnap] = useState<KaminoUsdcSnapshot | null>(null);
  const [walletPreview, setWalletPreview] = useState<KaminoRedeemPreview | null>(
    null
  );
  const [inventoryPreview, setInventoryPreview] =
    useState<KaminoRedeemPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isKaminoYieldBackend()) {
      setSnap(null);
      setWalletPreview(null);
      setInventoryPreview(null);
      return;
    }
    try {
      const s = await fetchKaminoUsdcSnapshotBrowser();
      setSnap(s);
      setError(null);

      const loadBal = async (owner: PublicKey) => {
        const ata = getAssociatedTokenAddressSync(KAMINO_CUSDC_MINT, owner, true);
        try {
          const acct = await getAccount(connection, ata);
          return acct.amount;
        } catch {
          return 0n;
        }
      };

      if (wallet) {
        const bal = await loadBal(wallet);
        setWalletPreview(
          bal > 0n ? await previewKaminoRedeemBrowser(bal) : null
        );
      } else {
        setWalletPreview(null);
      }

      if (inventoryOwner) {
        const bal = await loadBal(inventoryOwner);
        setInventoryPreview(
          bal > 0n ? await previewKaminoRedeemBrowser(bal) : null
        );
      } else {
        setInventoryPreview(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connection, wallet, inventoryOwner]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!shouldPollLiveState()) return;
    const id = window.setInterval(() => {
      if (shouldPollLiveState()) void refresh();
    }, DESK_LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!isKaminoYieldBackend()) return null;

  const hasPreview =
    (walletPreview && walletPreview.cTokenAmount > 0n) ||
    (inventoryPreview && inventoryPreview.cTokenAmount > 0n);

  return (
    <section className="kamino-yield-panel" aria-label="Kamino vault yield">
      <header className="kamino-yield-panel__head">
        <h3>Kamino (vault park)</h3>
        <span className="kamino-yield-panel__apy mono">
          {snap ? `${fmtApy(snap.supplyApy)} APY` : "—"}
        </span>
      </header>
      <p className="kamino-yield-panel__lead">
        Where idle vault USDC can earn later — not what you pay on the curve.
        {snap ? (
          <>
            {" "}
            Redeem rate:{" "}
            <span className="mono">
              1 {KAMINO_QUOTE_SYMBOL} = {snap.usdcPerCtoken.toFixed(4)} USDC
            </span>
            .
          </>
        ) : null}
      </p>
      {error && <p className="kamino-yield-panel__err">{error}</p>}
      {hasPreview ? (
        <div className="kamino-yield-panel__preview">
          {walletPreview && walletPreview.cTokenAmount > 0n ? (
            <p>
              Wallet: {fmtUsdc(walletPreview.cTokenAmount)} {KAMINO_QUOTE_SYMBOL}{" "}
              → {fmtUsdc(walletPreview.redeemableUsdc)} USDC
            </p>
          ) : null}
          {inventoryPreview && inventoryPreview.cTokenAmount > 0n ? (
            <p>
              Vault: {fmtUsdc(inventoryPreview.cTokenAmount)} {KAMINO_QUOTE_SYMBOL}{" "}
              → {fmtUsdc(inventoryPreview.redeemableUsdc)} USDC
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
