/** Session-only desk history — not persisted (Surfpool resets would go stale). */

export type DeskActivityKind =
  | "split"
  | "pool_request"
  | "dbc_launch"
  | "dbc_swap"
  | "redeem_pt"
  | "redeem_yt"
  | "unwrap";

export type ActivityFilter = "all" | "bonding" | "split" | "redemption";

export type DeskActivity = {
  id: string;
  kind: DeskActivityKind;
  symbol: string;
  yieldNonce: number;
  /** @deprecated Legacy window activities — use yieldNonce (start). */
  startNonce?: number;
  targetNonce?: number;
  at: number;
  signature: string;
  /** Human amount for splits / redeems / swaps */
  amount?: string;
  amountSymbol?: string;
  /** Bonding-curve buy YT (USDC in) or sell YT (YT in). */
  swapSide?: "buy" | "sell";
  pool?: string;
  baseMint?: string;
  quoteMint?: string;
};

let activities: DeskActivity[] = [];

export function activityYieldNonce(a: DeskActivity): number {
  return a.yieldNonce ?? a.startNonce ?? 0;
}

function activityId(kind: DeskActivityKind, signature: string) {
  return `${kind}:${signature}`;
}

export function loadDeskActivities(): DeskActivity[] {
  return activities.slice();
}

export function appendDeskActivity(
  entry: Omit<DeskActivity, "id" | "yieldNonce"> & {
    id?: string;
    yieldNonce?: number;
    startNonce?: number;
    targetNonce?: number;
  }
) {
  const nonce =
    entry.yieldNonce ?? entry.startNonce ?? activityYieldNonce(entry as DeskActivity);
  const id = entry.id ?? activityId(entry.kind, entry.signature || `${entry.at}`);
  activities = [
    { ...entry, yieldNonce: nonce, id },
    ...activities.filter((a) => a.id !== id),
  ].slice(0, 80);
}

export function activitiesForSymbol(symbol: string): DeskActivity[] {
  return loadDeskActivities().filter((a) => a.symbol === symbol);
}

export function matchesActivityFilter(
  kind: DeskActivityKind,
  filter: ActivityFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "bonding":
      return kind === "pool_request" || kind === "dbc_launch" || kind === "dbc_swap";
    case "split":
      return kind === "split";
    case "redemption":
      return kind === "redeem_pt" || kind === "redeem_yt" || kind === "unwrap";
    default:
      return true;
  }
}

export function filterActivities(
  activitiesList: DeskActivity[],
  filter: ActivityFilter
): DeskActivity[] {
  if (filter === "all") return activitiesList;
  return activitiesList.filter((a) => matchesActivityFilter(a.kind, filter));
}

export const ACTIVITY_FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bonding", label: "Bonding curve" },
  { id: "split", label: "Splits" },
  { id: "redemption", label: "Redemption" },
];

export function activityKindLabel(kind: DeskActivityKind): string {
  switch (kind) {
    case "split":
      return "Split";
    case "pool_request":
      return "Pool request";
    case "dbc_launch":
      return "curve-YT launch";
    case "dbc_swap":
      return "curve-YT swap";
    case "redeem_pt":
      return "strip PT redeem";
    case "redeem_yt":
      return "strip YT redeem";
    case "unwrap":
      return "Unwrap";
    default:
      return kind;
  }
}
