import { useEffect } from "react";
import Link from "next/link";
import { StockLogo } from "./StockLogo";
import {
  activitiesForSymbol,
  activityKindLabel,
  activityYieldNonce,
  type DeskActivity,
} from "../lib/desk-activity";
import { curveYtNonceLabel } from "../lib/curve-yt-labels";
import { launchYieldNonce } from "../lib/meteora-dbc";
import type { StockPortfolio } from "../lib/portfolio";
import { solscanTxUrl } from "../lib/solscan";

type Props = {
  stock: StockPortfolio;
  rpcEndpoint: string;
  onClose: () => void;
};

function activityLine(row: DeskActivity): string {
  const nonce = `n${activityYieldNonce(row)}`;
  if (row.amount) return `${row.amount} ${row.amountSymbol ?? ""} · ${nonce}`.trim();
  return nonce;
}

export function ownedWindowCount(stock: StockPortfolio): number {
  return stock.windows.filter((w) => w.ptRaw > 0n || w.ytRaw > 0n).length;
}

export function DashboardStockModal({ stock, rpcEndpoint, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const owned = stock.windows.filter((w) => w.ptRaw > 0n || w.ytRaw > 0n);
  const activities = activitiesForSymbol(stock.market.symbol);

  return (
    <div className="dashboard-modal-root" role="presentation">
      <button
        type="button"
        className="dashboard-modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="dashboard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-modal-title"
      >
        <header className="dashboard-modal-head">
          <StockLogo
            symbol={stock.market.symbol}
            name={stock.market.name}
            size={36}
          />
          <div className="dashboard-modal-head-text">
            <h2 id="dashboard-modal-title">{stock.market.symbol}</h2>
            <p className="hint">{stock.market.name}</p>
          </div>
          <button
            type="button"
            className="dashboard-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="dashboard-modal-scroll">
          <dl className="dashboard-modal-stats">
            <div>
              <dt>xStock</dt>
              <dd className="mono">
                {stock.underlyingUi} {stock.market.symbol}
              </dd>
            </div>
            <div>
              <dt>Strip series</dt>
              <dd>{owned.length} owned</dd>
            </div>
            <div>
              <dt>DBC pools</dt>
              <dd>{stock.dbcPools.length}</dd>
            </div>
          </dl>

          {owned.length > 0 ? (
            <section className="dashboard-section">
              <h3>strip PT / strip YT</h3>
              <p className="hint dashboard-section-note">
                Real DivStrip legs from splitting xStock — amounts in xStock
                units.
              </p>
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Nonce</th>
                      <th>PT</th>
                      <th>YT</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {owned.map((w) => (
                      <tr key={w.yieldNonce}>
                        <td className="mono">n{w.yieldNonce}</td>
                        <td className="mono">{w.ptAmount}</td>
                        <td className="mono">{w.ytAmount}</td>
                        <td>
                          <Link
                            href={`/app?symbol=${encodeURIComponent(stock.market.symbol)}&nonce=${w.yieldNonce}`}
                            className="dashboard-row-link"
                            onClick={onClose}
                          >
                            Desk ↗
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {stock.dbcPools.length > 0 ? (
            <section className="dashboard-section">
              <h3>Meteora curve-YT pools</h3>
              <ul className="dashboard-dbc-list">
                {stock.dbcPools.map(({ launch, phase, progressPct }) => (
                  <li key={launch.pool}>
                    <div className="dashboard-dbc-main">
                      <span className="mono">
                        {curveYtNonceLabel(
                          stock.market.symbol,
                          launchYieldNonce(launch)
                        )}
                      </span>
                      <span className="dashboard-dbc-phase">{phase}</span>
                    </div>
                    <div className="dashboard-dbc-meta hint mono">
                      Pool {launch.pool.slice(0, 10)}…
                      {progressPct != null ? <> · {progressPct}% curve</> : null}
                    </div>
                    <Link
                      href={`/app?symbol=${encodeURIComponent(stock.market.symbol)}&nonce=${launchYieldNonce(launch)}`}
                      className="dashboard-row-link"
                      onClick={onClose}
                    >
                      Trade on desk ↗
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {activities.length > 0 ? (
            <section className="dashboard-section dashboard-section-compact">
              <h3>Recent activity</h3>
              <ul className="dashboard-activity-list">
                {activities.slice(0, 12).map((row) => (
                  <li key={row.id}>
                    <span className={`activity-kind activity-kind-${row.kind}`}>
                      {activityKindLabel(row.kind)}
                    </span>
                    <span className="mono dashboard-activity-summary">
                      {activityLine(row)}
                    </span>
                    {row.signature ? (
                      <a
                        className="dashboard-row-link"
                        href={solscanTxUrl(row.signature, rpcEndpoint)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Tx ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <footer className="dashboard-modal-foot">
          <Link
            href={`/app?symbol=${encodeURIComponent(stock.market.symbol)}`}
            className="btn btn-primary btn-sm"
            onClick={onClose}
          >
            Open on desk
          </Link>
        </footer>
      </div>
    </div>
  );
}
