"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildYieldNonceMaturityMap,
  formatYieldNonceWindowLabel,
  maturityForYieldNonce,
  type YieldNonceMaturity,
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

function optionMeta(
  n: number,
  tipNonce: number,
  maturity: YieldNonceMaturity | null
): string {
  if (n === tipNonce) return "Current tip";
  if (n > tipNonce) return `Forward +${n - tipNonce}`;
  return "Past";
}

export function YieldNoncePicker({
  tipNonce,
  nonceMax,
  value,
  onChange,
  caRows,
  datesLoading = false,
  disabled = false,
  id = "yield-nonce-select",
  className = "",
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const schedule = useMemo(
    () => buildYieldNonceMaturityMap(caRows),
    [caRows]
  );

  const options = useMemo(() => {
    const out: number[] = [];
    for (let n = tipNonce; n <= nonceMax; n += 1) out.push(n);
    return out;
  }, [tipNonce, nonceMax]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedLabel = datesLoading
    ? `N${value} · …`
    : formatYieldNonceWindowLabel(value, schedule);

  const locked = disabled || datesLoading;

  return (
    <div
      ref={rootRef}
      className={`nonce-picker ${className}`.trim()}
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        id={id}
        className="nonce-picker-trigger"
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Yield nonce window"
        aria-busy={datesLoading}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="nonce-picker-trigger-main">
          <span className="nonce-picker-trigger-label mono">{selectedLabel}</span>
          <span className="nonce-picker-trigger-hint">
            {optionMeta(value, tipNonce, maturityForYieldNonce(schedule, value))}
          </span>
        </span>
        <span className="nonce-picker-caret" aria-hidden />
      </button>

      {open ? (
        <ul
          id={listId}
          className="nonce-picker-list"
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((n) => {
            const mat = maturityForYieldNonce(schedule, n);
            const label = datesLoading
              ? `N${n}`
              : formatYieldNonceWindowLabel(n, schedule);
            const selected = n === value;
            return (
              <li key={n} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={
                    selected
                      ? "nonce-picker-option is-selected"
                      : "nonce-picker-option"
                  }
                  onClick={() => {
                    onChange(n);
                    setOpen(false);
                  }}
                >
                  <span className="nonce-picker-option-top">
                    <span className="mono nonce-picker-option-n">N{n}</span>
                    <span className="nonce-picker-option-meta">
                      {optionMeta(n, tipNonce, mat)}
                    </span>
                  </span>
                  <span className="nonce-picker-option-date mono">
                    {datesLoading
                      ? "…"
                      : mat
                        ? `${mat.estimated || mat.upcoming ? "est. " : ""}${new Date(
                            mat.effectiveTimeUtc
                          ).toLocaleDateString("en-US", {
                            month: "long",
                            year: "numeric",
                          })}`
                        : "date TBD"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Keep a native select for form semantics / a11y fallback hidden */}
      <select
        className="nonce-picker-native"
        tabIndex={-1}
        aria-hidden
        value={value}
        disabled={locked}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {formatYieldNonceWindowLabel(n, schedule)}
          </option>
        ))}
      </select>
    </div>
  );
}
