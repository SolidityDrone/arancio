import { corporateActionKind } from "./registry-nonces";
import { seriesPhase, type SeriesPhase } from "./strip-math";
import type { CaListRow } from "./xstocks-api";

const KIND_YIELD = 0;
/** Fallback cadence when history is thin (quarterly). */
const DEFAULT_MS_PER_YIELD = 90 * 24 * 60 * 60 * 1000;

function includeInNonceReplay(row: CaListRow, kind: number): boolean {
  if (kind === KIND_YIELD) return true;
  return Boolean(row.multiplierOld && row.multiplierNew);
}

export type YieldNonceMaturity = {
  effectiveTimeUtc: string;
  upcoming: boolean;
  /** True when projected from cadence (not a recorded CA). */
  estimated?: boolean;
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
        estimated: false,
      });
    }
  }

  return out;
}

/** Median interval between consecutive known yield tips (ms). */
function medianYieldIntervalMs(
  schedule: Map<number, YieldNonceMaturity>
): number {
  const keys = [...schedule.keys()].sort((a, b) => a - b);
  if (keys.length < 2) return DEFAULT_MS_PER_YIELD;
  const gaps: number[] = [];
  for (let i = 1; i < keys.length; i += 1) {
    const a = new Date(schedule.get(keys[i - 1])!.effectiveTimeUtc).getTime();
    const b = new Date(schedule.get(keys[i])!.effectiveTimeUtc).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) gaps.push(b - a);
  }
  if (gaps.length === 0) return DEFAULT_MS_PER_YIELD;
  gaps.sort((x, y) => x - y);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0
    ? Math.round((gaps[mid - 1] + gaps[mid]) / 2)
    : gaps[mid];
}

/**
 * Maturity for strip window n = when tip advances to n+1 (next yield CA).
 * Forward windows without a recorded CA are projected from historical cadence.
 */
export function maturityForYieldNonce(
  schedule: Map<number, YieldNonceMaturity>,
  yieldNonce: number
): YieldNonceMaturity | null {
  const known = schedule.get(yieldNonce + 1);
  if (known) return known;

  const keys = [...schedule.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return null;

  const lastKey = keys[keys.length - 1]!;
  const last = schedule.get(lastKey)!;
  const lastTs = new Date(last.effectiveTimeUtc).getTime();
  if (!Number.isFinite(lastTs)) return null;

  const targetTip = yieldNonce + 1;
  if (targetTip <= lastKey) {
    return schedule.get(targetTip) ?? null;
  }

  const step = medianYieldIntervalMs(schedule);
  const stepsAhead = targetTip - lastKey;
  const est = new Date(lastTs + stepsAhead * step);
  return {
    effectiveTimeUtc: est.toISOString(),
    upcoming: true,
    estimated: true,
  };
}

export function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

/** e.g. "September 2028" */
export function formatMonthYearLong(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${month} ${d.getFullYear()}`;
}

/** Best CA / projected date for labeling a strip window. */
export function windowDateForYieldNonce(
  schedule: Map<number, YieldNonceMaturity>,
  yieldNonce: number
): YieldNonceMaturity | null {
  return (
    maturityForYieldNonce(schedule, yieldNonce) ??
    schedule.get(yieldNonce) ??
    null
  );
}

/**
 * Desk / dropdown label, e.g. `N5 · est. September 2028` or `N3 · March 2026`.
 */
export function formatYieldNonceWindowLabel(
  yieldNonce: number,
  schedule: Map<number, YieldNonceMaturity>
): string {
  const when = windowDateForYieldNonce(schedule, yieldNonce);
  if (!when) return `N${yieldNonce}`;
  const monthYear = formatMonthYearLong(when.effectiveTimeUtc);
  const prefix = when.estimated || when.upcoming ? "est. " : "";
  return `N${yieldNonce} · ${prefix}${monthYear}`;
}

export function formatNonceMaturityLabel(
  tipNonce: number,
  yieldNonce: number,
  maturity: YieldNonceMaturity | null
): string | null {
  if (!maturity) return null;
  const phase = seriesPhase(tipNonce, yieldNonce);
  const when = formatMonthYearLong(maturity.effectiveTimeUtc);
  return formatMaturityLabelForPhase(
    phase,
    when,
    maturity.upcoming || Boolean(maturity.estimated)
  );
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
    return upcoming ? `est. ${when}` : `Maturity ${when}`;
  }
  return `est. ${when}`;
}
