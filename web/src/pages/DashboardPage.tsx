import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  DashboardStockModal,
  ownedWindowCount,
} from "../components/DashboardStockModal";
import { Nav } from "../components/Nav";
import { StockLogo } from "../components/StockLogo";
import { fetchWalletPortfolio, type StockPortfolio } from "../lib/portfolio";

function stockSummary(stock: StockPortfolio): string {
  const parts: string[] = [];
  const owned = ownedWindowCount(stock);
  if (owned > 0) {
    parts.push(`${owned} owned`);
  }
  if (stock.dbcPools.length > 0) {
    parts.push(
      `${stock.dbcPools.length} pool${stock.dbcPools.length === 1 ? "" : "s"}`
    );
  }
  if (stock.underlyingRaw > 0n && owned === 0) {
    parts.push("xStock only");
  }
  return parts.join(" · ");
}

export function DashboardPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [portfolio, setPortfolio] = useState<StockPortfolio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalStock, setModalStock] = useState<StockPortfolio | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.publicKey) {
      setPortfolio([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchWalletPortfolio(connection, wallet.publicKey);
      setPortfolio(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load portfolio");
      setPortfolio([]);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalOwnedWindows = useMemo(
    () => portfolio.reduce((n, s) => n + ownedWindowCount(s), 0),
    [portfolio]
  );
  const totalPools = portfolio.reduce((n, s) => n + s.dbcPools.length, 0);

  return (
    <>
      <Nav />
      <div className="dashboard-page">
        <div className="dashboard-page-veil" aria-hidden />
        <div className="shell dashboard-shell">
          <header className="dashboard-head">
            <div>
              <h1>Portfolio</h1>
              <p className="hint dashboard-sub">
                Tap a row to see PT/YT windows, DBC pools, and activity.
              </p>
            </div>
            <div className="dashboard-head-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loading || !wallet.publicKey}
                onClick={() => void refresh()}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              <Link to="/app" className="btn btn-primary btn-sm">
                Open desk
              </Link>
            </div>
          </header>

          {!wallet.publicKey ? (
            <section className="dashboard-empty">
              <p>Connect your wallet to see holdings.</p>
            </section>
          ) : loading && portfolio.length === 0 ? (
            <section className="dashboard-empty">
              <p>Loading portfolio from Surfpool…</p>
            </section>
          ) : error ? (
            <section className="dashboard-empty">
              <p>{error}</p>
            </section>
          ) : portfolio.length === 0 ? (
            <section className="dashboard-empty">
              <p>No xStock or strip positions found in this wallet.</p>
              <Link to="/app" className="btn btn-primary">
                Split your first position
              </Link>
            </section>
          ) : (
            <>
              <dl className="dashboard-summary">
                <div>
                  <dt>Stocks</dt>
                  <dd>{portfolio.length}</dd>
                </div>
                <div>
                  <dt>Strip windows</dt>
                  <dd>{totalOwnedWindows}</dd>
                </div>
                <div>
                  <dt>DBC pools</dt>
                  <dd>{totalPools}</dd>
                </div>
              </dl>

              <ul className="dashboard-list">
                {portfolio.map((stock) => {
                  const summary = stockSummary(stock);
                  return (
                    <li key={stock.market.symbol}>
                      <button
                        type="button"
                        className="dashboard-row"
                        onClick={() => setModalStock(stock)}
                      >
                        <StockLogo
                          symbol={stock.market.symbol}
                          name={stock.market.name}
                          size={36}
                        />
                        <span className="dashboard-row-id">
                          <span className="dashboard-row-sym">
                            {stock.market.symbol}
                          </span>
                          <span className="hint dashboard-row-name">
                            {stock.market.name}
                          </span>
                        </span>
                        <span className="dashboard-row-meta">
                          {summary ? (
                            <span className="dashboard-row-owned">{summary}</span>
                          ) : null}
                          <span className="dashboard-row-xstock mono">
                            {stock.underlyingUi} xStock
                          </span>
                        </span>
                        <span className="dashboard-row-chevron" aria-hidden>
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      {modalStock ? (
        <DashboardStockModal
          stock={modalStock}
          rpcEndpoint={connection.rpcEndpoint}
          onClose={() => setModalStock(null)}
        />
      ) : null}
    </>
  );
}
