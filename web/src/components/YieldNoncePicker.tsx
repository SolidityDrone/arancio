import { useMemo } from "react";
import {
  buildYieldNonceMaturityMap,
  formatYieldNonceWindowLabel,
} from "../lib/yield-nonce-dates";
import type { CaListRow } from "../lib/xstocks-api";

type Props = {
  tipNonce: number;
  nonceMax: number;
  value: number;
  onChange: (yieldNonce: number) => void;
  caRows: CaListRow[];
  datesLoading?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function YieldNoncePicker({
  tipNonce,
  nonceMax,
  value,
  onChange,
  caRows,
  datesLoading = false,
  disabled = false,
  id = "yield-nonce-select",
  className = "desk-select mono desk-select-full",
}: Props) {
  const schedule = useMemo(
    () => buildYieldNonceMaturityMap(caRows),
    [caRows]
  );

  const options = useMemo(() => {
    const out: number[] = [];
    for (let n = tipNonce; n <= nonceMax; n += 1) out.push(n);
    return out;
  }, [tipNonce, nonceMax]);

  return (
    <select
      id={id}
      className={className}
      value={value}
      disabled={disabled || datesLoading}
      aria-label="Yield nonce window"
      aria-busy={datesLoading}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {datesLoading && n === value
            ? `N${n} (…)`
            : formatYieldNonceWindowLabel(n, schedule)}
        </option>
      ))}
    </select>
  );
}
