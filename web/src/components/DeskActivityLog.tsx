import { useMemo, useState } from "react";
import {
  ACTIVITY_FILTERS,
  activityKindLabel,
  filterActivities,
  type ActivityFilter,
  type DeskActivity,
} from "../lib/desk-activity";
import { curveYtTicker } from "../lib/curve-yt-labels";
import { solscanTxUrl } from "../lib/solscan";

type Props = {
  rpcEndpoint: string;
  symbol: string;
  activities: DeskActivity[];
};

function formatWhen(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activitySummary(row: DeskActivity): string {
  const window = `n${row.startNonce}→n${row.targetNonce}`;
  switch (row.kind) {
    case "split":
      return row.amount
        ? `${row.amount} ${row.amountSymbol ?? row.symbol} · ${window}`
        : window;
    case "dbc_launch":
      return `curve-YT pool · ${window}`;
    case "dbc_swap": {
      const dir =
        row.swapSide === "sell" ? "Sell curve-YT" : "Buy curve-YT";
      const ticker = curveYtTicker(row.symbol);
      return row.amount
        ? `${dir} · ${row.amount} ${row.amountSymbol ?? ticker} · ${window}`
        : `${dir} · ${ticker} · ${window}`;
    }
    case "redeem_pt":
      return row.amount
        ? `${row.amount} ${row.amountSymbol ?? row.symbol} capital · ${window}`
        : `PT redeem · ${window}`;
    case "redeem_yt":
      return row.amount
        ? `${row.amount} ${row.amountSymbol ?? row.symbol} coupon · ${window}`
        : `strip YT redeem · ${window}`;
    case "unwrap":
      return row.amount
        ? `Unwrap ${row.amount} ${row.amountSymbol ?? row.symbol} · ${window}`
        : `Unwrap · ${window}`;
    default:
      return window;
  }
}

const EMPTY_BY_FILTER: Record<ActivityFilter, string> = {
  all: "No transactions yet — split or swap to log your first action here.",
  bonding:
    "No curve-YT actions yet — launch or swap curve-YT on the Meteora panel above.",
  split: "No splits logged yet — split xStock into strip PT + strip YT above.",
  redemption:
    "No redemptions yet — redeem strip PT/YT when a window matures.",
};

export function DeskActivityLog({ rpcEndpoint, symbol, activities }: Props) {
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const filtered = useMemo(
    () => filterActivities(activities, filter),
    [activities, filter]
  );

  const counts = useMemo(() => {
    const tally: Record<ActivityFilter, number> = {
      all: activities.length,
      bonding: filterActivities(activities, "bonding").length,
      split: filterActivities(activities, "split").length,
      redemption: filterActivities(activities, "redemption").length,
    };
    return tally;
  }, [activities]);

  return (
    <section className="desk-activity" aria-labelledby="activity-heading">
      <header className="desk-activity-head">
        <div className="desk-activity-head-row">
          <h2 id="activity-heading">History</h2>
          <span className="desk-activity-count mono">{activities.length}</span>
        </div>
        <p className="hint">On-chain actions for {symbol} on this RPC.</p>
        <div
          className="activity-filters"
          role="tablist"
          aria-label="Filter history by action type"
        >
          {ACTIVITY_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className="activity-filter-count">{counts[id]}</span>
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="hint desk-activity-empty">
          {activities.length === 0
            ? EMPTY_BY_FILTER.all.replace("split or swap", `split ${symbol} or swap`)
            : EMPTY_BY_FILTER[filter]}
        </p>
      ) : (
        <ul className="activity-list">
          {filtered.map((row) => (
            <li key={row.id} className="activity-row">
              <div className="activity-row-main">
                <span className={`activity-kind activity-kind-${row.kind}`}>
                  {activityKindLabel(row.kind)}
                </span>
                <div className="activity-row-body">
                  <span className="activity-summary mono">
                    {activitySummary(row)}
                  </span>
                  <span className="activity-when">{formatWhen(row.at)}</span>
                </div>
                {row.signature ? (
                  <a
                    className="activity-link"
                    href={solscanTxUrl(row.signature, rpcEndpoint)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Solscan ↗
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
