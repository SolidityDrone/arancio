import { loadLaunches } from "./meteora-dbc";
import { loadStripPositions } from "./strip-positions";

const ACTIVITY_KEY = "divstrip.desk.activity.v1";

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
  startNonce: number;
  targetNonce: number;
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

function activityId(kind: DeskActivityKind, signature: string) {
  return `${kind}:${signature}`;
}

export function loadDeskActivities(): DeskActivity[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (raw) {
      return JSON.parse(raw) as DeskActivity[];
    }
  } catch {
    /* fall through to migration */
  }
  return migrateLegacyActivity();
}

function migrateLegacyActivity(): DeskActivity[] {
  const merged: DeskActivity[] = [];
  const seen = new Set<string>();

  for (const p of loadStripPositions()) {
    if (!p.signature) continue;
    const id = activityId("split", p.signature);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({
      id,
      kind: "split",
      symbol: p.symbol,
      startNonce: p.startNonce,
      targetNonce: p.targetNonce,
      at: p.splitAt,
      signature: p.signature,
      amount: p.amount,
      amountSymbol: p.symbol,
    });
  }

  for (const l of loadLaunches()) {
    const sig = l.launchSignature ?? `pool:${l.pool}`;
    const id = activityId("dbc_launch", sig);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({
      id,
      kind: "dbc_launch",
      symbol: l.symbol,
      startNonce: l.startNonce,
      targetNonce: l.targetNonce,
      at: l.launchedAt,
      signature: l.launchSignature ?? "",
      pool: l.pool,
      baseMint: l.baseMint,
      quoteMint: l.quoteMint,
    });
  }

  merged.sort((a, b) => b.at - a.at);
  if (merged.length > 0) {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(merged.slice(0, 80)));
  }
  return merged;
}

export function appendDeskActivity(
  entry: Omit<DeskActivity, "id"> & { id?: string }
) {
  const id = entry.id ?? activityId(entry.kind, entry.signature || `${entry.at}`);
  const all = loadDeskActivities().filter((a) => a.id !== id);
  all.unshift({ ...entry, id });
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.slice(0, 80)));
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
  activities: DeskActivity[],
  filter: ActivityFilter
): DeskActivity[] {
  if (filter === "all") return activities;
  return activities.filter((a) => matchesActivityFilter(a.kind, filter));
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
