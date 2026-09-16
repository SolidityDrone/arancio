import { MULTIPLIER_SCALE } from "./markets";

export type WindowPhase = "forward" | "locked" | "mature";

export function windowPhase(
  tipNonce: number,
  start: number,
  target: number
): WindowPhase {
  if (tipNonce < start) return "forward";
  if (tipNonce < target) return "locked";
  return "mature";
}

export function phaseLabel(phase: WindowPhase): string {
  switch (phase) {
    case "forward":
      return "Forward · start not reached";
    case "locked":
      return "Locked · awaiting maturity";
    case "mature":
      return "Mature · redeemable";
  }
}

export function legRates(cumStart: bigint, cumTarget: bigint): {
  ptShare: number;
  ytShare: number;
} {
  if (cumTarget <= 0n) return { ptShare: 1, ytShare: 0 };
  const ptShare = Number(cumStart) / Number(cumTarget);
  return { ptShare, ytShare: Math.max(0, 1 - ptShare) };
}

/** On-chain redeem_capital / redeem_yield output (raw underlying units). */
export function redeemOutputRaw(
  legAmountRaw: bigint,
  cumStart: bigint,
  cumTarget: bigint,
  isPt: boolean
): bigint {
  if (cumTarget <= 0n || legAmountRaw <= 0n) return 0n;
  const capitalOut = (legAmountRaw * cumStart) / cumTarget;
  if (isPt) return capitalOut;
  return legAmountRaw - capitalOut;
}

export function formatRawAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function defaultCumY(cum: bigint | null): bigint {
  return cum && cum > 0n ? cum : MULTIPLIER_SCALE;
}
