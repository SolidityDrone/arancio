import { caRowKey, type CorporateAction } from "./xstocks-api";

const KIND_YIELD = 0;
const KIND_SUPPLY = 1;
const KIND_OTHER = 2;

/** Matches ca_registry + seed-registry / CRE kind mapping. */
export function corporateActionKind(caType: string): number | null {
  switch (caType) {
    case "CashDividend":
    case "StockDividend":
      return KIND_YIELD;
    case "ForwardSplit":
    case "ReverseSplit":
      return KIND_SUPPLY;
    case "SpinOff":
      return KIND_OTHER;
    default:
      return null;
  }
}

export type RegistryNonceInfo = {
  /** Registry tip after this event is applied (unchanged for supply/other). */
  yieldNonce: number;
  /** True when this CA advances `current_yield_nonce` (dividends only). */
  advancesTip: boolean;
};

/**
 * Replay CA history in effective-time order — same rules as ca_registry
 * `apply_decoded_payload`: only CashDividend / StockDividend bump yield_nonce.
 */
function includeInNonceReplay(action: CorporateAction, kind: number): boolean {
  if (kind === KIND_YIELD) {
    // Project nonces for scheduled dividends before multipliers exist.
    return true;
  }
  return Boolean(action.multiplierOld && action.multiplierNew);
}

export function assignRegistryYieldNonces(
  actions: CorporateAction[]
): Map<string, RegistryNonceInfo> {
  const ordered = actions
    .map((a) => ({
      action: a,
      kind: corporateActionKind(a.caType),
      ts: new Date(a.effectiveTimeUtc).getTime(),
    }))
    .filter(
      (row): row is typeof row & { kind: number } =>
        row.kind != null && includeInNonceReplay(row.action, row.kind)
    )
    .sort(
      (a, b) =>
        a.ts - b.ts || caRowKey(a.action).localeCompare(caRowKey(b.action))
    );

  const out = new Map<string, RegistryNonceInfo>();
  let yieldNonce = 0;

  for (const { action, kind } of ordered) {
    if (kind === KIND_YIELD) {
      yieldNonce += 1;
    }
    const info: RegistryNonceInfo = {
      yieldNonce,
      advancesTip: kind === KIND_YIELD,
    };
    out.set(caRowKey(action), info);
  }

  return out;
}
