import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Nav } from "../components/Nav";
import { StockLogo } from "../components/StockLogo";
import {
  fetchWalletPortfolio,
  flattenOwnedSchedules,
  type OwnedSchedule,
  type StockPortfolio,
} from "../lib/portfolio";
import {
  buildYieldNonceMaturityMap,
  formatYieldNonceWindowLabel,
  type YieldNonceMaturity,
} from "../lib/yield-nonce-dates";
import { buildCaListRows, fetchMarketIntel } from "../lib/xstocks-api";

export function DashboardPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [portfolio, setPortfolio] = useState<StockPortfolio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonceSchedules, setNonceSchedules] = useState<
    Map<string, Map<number, YieldNonceMaturity>>
  >(new Map());

  const schedules = useMemo(
    () => flattenOwnedSchedules(portfolio),
    [portfolio]
  );

  const refresh = useCallback(async () => {
    if (!wallet.publicKey) {
      setPortfolio([]);
      setLoading(false);
      setError(null);
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
    let cancelled = false;
    const run = async () => {
      if (!wallet.publicKey) {
        if (!cancelled) {
          setPortfolio([]);
          setLoading(false);
          setError(null);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      try {
        const rows = await fetchWalletPortfolio(connection, wallet.publicKey);
        if (!cancelled) setPortfolio(rows);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load portfolio"
          );
          setPortfolio([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    const symbols = [...new Set(schedules.map((s) => s.market.symbol))];
    if (symbols.length === 0) {
      setNonceSchedules(new Map());
      return;
    }
    let cancelled = false;
    void Promise.all(
      symbols.map(async (symbol) => {
        try {
          const intel = await fetchMarketIntel(symbol);
          const rows = buildCaListRows(intel.history, intel.upcoming);
          return [symbol, buildYieldNonceMaturityMap(rows)] as const;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const next = new Map<string, Map<number, YieldNonceMaturity>>();
      for (const row of results) {
        if (row) next.set(row[0], row[1]);
      }
      setNonceSchedules(next);
    });
    return () => {
      cancelled = true;
    };
  }, [schedules]);

  const stockCount = useMemo(
    () => new Set(schedules.map((s) => s.market.symbol)).size,
    [schedules]
  );

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
                Owned strip schedules — tap a card to open on the desk.
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
              <Link href="/app" className="btn btn-primary btn-sm">
                Open desk
              </Link>
            </div>
          </header>

          {!wallet.publicKey ? (
            <section className="dashboard-empty">
              <p>Connect your wallet to see holdings.</p>
            </section>
          ) : loading && schedules.length === 0 ? (
            <section className="dashboard-empty">
              <p>Loading portfolio from Surfpool…</p>
            </section>
          ) : error ? (
            <section className="dashboard-empty">
              <p>{error}</p>
            </section>
          ) : schedules.length === 0 ? (
            <section className="dashboard-empty">
              <p>No owned strip schedules in this wallet.</p>
              <Link href="/app" className="btn btn-primary">
                Split your first position
              </Link>
            </section>
          ) : (
            <>
              <dl className="dashboard-summary dashboard-summary-compact">
                <div>
                  <dt>Schedules</dt>
                  <dd>{schedules.length}</dd>
                </div>
                <div>
                  <dt>Stocks</dt>
                  <dd>{stockCount}</dd>
                </div>
              </dl>

              <ul className="dashboard-schedule-grid">
                {schedules.map((schedule) => (
                  <ScheduleCard
                    key={`${schedule.market.symbol}-${schedule.yieldNonce}`}
                    schedule={schedule}
                    maturitySchedule={
                      nonceSchedules.get(schedule.market.symbol) ??
                      new Map()
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ScheduleCard({
  schedule,
  maturitySchedule,
}: {
  schedule: OwnedSchedule;
  maturitySchedule: Map<number, YieldNonceMaturity>;
}) {
  const label = formatYieldNonceWindowLabel(
    schedule.yieldNonce,
    maturitySchedule
  );
  const href = `/app?symbol=${encodeURIComponent(schedule.market.symbol)}&nonce=${schedule.yieldNonce}`;

  return (
    <li>
      <Link href={href} className="dashboard-schedule-card">
        <div className="dashboard-schedule-card-head">
          <StockLogo
            symbol={schedule.market.symbol}
            name={schedule.market.name}
            size={28}
          />
          <span className="dashboard-schedule-sym">{schedule.market.symbol}</span>
        </div>
        <span className="dashboard-schedule-nonce">{label}</span>
        <dl className="dashboard-schedule-legs">
          <div>
            <dt>PT</dt>
            <dd className="mono">{schedule.ptAmount}</dd>
          </div>
          <div>
            <dt>YT</dt>
            <dd className="mono">{schedule.ytAmount}</dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}
