import {
  activityKindLabel,
  type DeskActivity,
} from "../lib/desk-activity";
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
      return `YT pool · ${window}`;
    case "redeem_pt":
      return row.amount
        ? `${row.amount} ${row.amountSymbol ?? row.symbol} capital · ${window}`
        : `PT redeem · ${window}`;
    case "redeem_yt":
      return row.amount
        ? `${row.amount} ${row.amountSymbol ?? row.symbol} coupon · ${window}`
        : `YT redeem · ${window}`;
    case "unwrap":
      return row.amount
        ? `Unwrap ${row.amount} ${row.amountSymbol ?? row.symbol} · ${window}`
        : `Unwrap · ${window}`;
    default:
      return window;
  }
}

export function DeskActivityLog({ rpcEndpoint, symbol, activities }: Props) {
  return (
    <section className="desk-activity" aria-labelledby="activity-heading">
      <header className="desk-activity-head">
        <h2 id="activity-heading">History</h2>
        <p className="hint">On-chain actions for {symbol} on this RPC.</p>
      </header>

      {activities.length === 0 ? (
        <p className="hint desk-activity-empty">
          No transactions yet — split {symbol} above to log your first action here.
        </p>
      ) : (
        <ul className="activity-list">
          {activities.map((row) => (
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
