import { loadLaunches } from "./meteora-dbc";
import { loadStripPositions } from "./strip-positions";

const ACTIVITY_KEY = "divstrip.desk.activity.v1";

export type DeskActivityKind =
  | "split"
  | "dbc_launch"
  | "redeem_pt"
  | "redeem_yt"
  | "unwrap";

export type DeskActivity = {
  id: string;
  kind: DeskActivityKind;
  symbol: string;
  startNonce: number;
  targetNonce: number;
  at: number;
  signature: string;
  /** Human amount for splits / redeems */
  amount?: string;
  amountSymbol?: string;
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

export function activityKindLabel(kind: DeskActivityKind): string {
  switch (kind) {
    case "split":
      return "Split";
    case "dbc_launch":
      return "Meteora DBC";
    case "redeem_pt":
      return "Redeem PT";
    case "redeem_yt":
      return "Redeem YT";
    case "unwrap":
      return "Unwrap";
    default:
      return kind;
  }
}
