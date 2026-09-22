import { corporateActionKind } from "./registry-nonces";
import { seriesPhase, type SeriesPhase } from "./strip-math";
import type { CaListRow } from "./xstocks-api";

const KIND_YIELD = 0;

function includeInNonceReplay(
  row: CaListRow,
  kind: number
): boolean {
  if (kind === KIND_YIELD) return true;
  return Boolean(row.multiplierOld && row.multiplierNew);
}

export type YieldNonceMaturity = {
  effectiveTimeUtc: string;
  upcoming: boolean;
};

/** Registry tip after each yield CA — same replay order as ca_registry / assignRegistryYieldNonces. */
export function buildYieldNonceMaturityMap(
  caRows: CaListRow[]
): Map<number, YieldNonceMaturity> {
  const ordered = [...caRows]
    .map((row) => ({
      row,
      kind: corporateActionKind(row.caType),
      ts: new Date(row.effectiveTimeUtc).getTime(),
    }))
    .filter(
      (entry): entry is typeof entry & { kind: number } =>
        entry.kind != null && includeInNonceReplay(entry.row, entry.kind)
    )
    .sort((a, b) => a.ts - b.ts);

  let yieldNonce = 0;
  const out = new Map<number, YieldNonceMaturity>();

  for (const { row, kind } of ordered) {
    if (kind === KIND_YIELD) {
      yieldNonce += 1;
      out.set(yieldNonce, {
        effectiveTimeUtc: row.effectiveTimeUtc,
        upcoming: row.upcoming,
      });
    }
  }

  return out;
}

export function maturityForYieldNonce(
  schedule: Map<number, YieldNonceMaturity>,
  yieldNonce: number
): YieldNonceMaturity | null {
  return schedule.get(yieldNonce + 1) ?? null;
}

export function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

/** e.g. "March, 2026" */
export function formatMonthYearLong(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${month}, ${d.getFullYear()}`;
}

/** Best CA date for labeling a strip window (maturity ex-div, else next known). */
export function windowDateForYieldNonce(
  schedule: Map<number, YieldNonceMaturity>,
  yieldNonce: number
): YieldNonceMaturity | null {
  return (
    maturityForYieldNonce(schedule, yieldNonce) ??
    schedule.get(yieldNonce + 1) ??
    schedule.get(yieldNonce) ??
    null
  );
}

/** Primary desk label, e.g. `N5 (March, 2026)`. */
export function formatYieldNonceWindowLabel(
  yieldNonce: number,
  schedule: Map<number, YieldNonceMaturity>
): string {
  const when = windowDateForYieldNonce(schedule, yieldNonce);
  if (!when) return `N${yieldNonce}`;
  return `N${yieldNonce} (${formatMonthYearLong(when.effectiveTimeUtc)})`;
}

export function formatNonceMaturityLabel(
  tipNonce: number,
  yieldNonce: number,
  maturity: YieldNonceMaturity | null
): string | null {
  if (!maturity) return null;
  const phase = seriesPhase(tipNonce, yieldNonce);
  const when = formatMonthYear(maturity.effectiveTimeUtc);
  return formatMaturityLabelForPhase(phase, when, maturity.upcoming);
}

export function formatMaturityLabelForPhase(
  phase: SeriesPhase,
  when: string,
  upcoming: boolean
): string {
  if (phase === "mature") {
    return upcoming ? `Matured ~${when}` : `Matured ${when}`;
  }
  if (phase === "locked") {
    return upcoming ? `Matures ~${when}` : `Maturity ~${when}`;
  }
  return `Est. ${when}`;
}
