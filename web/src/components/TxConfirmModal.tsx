import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  getTxModalState,
  subscribeTxModal,
  type TxModalPhase,
} from "../lib/tx-modal-store";

function phaseTitle(phase: TxModalPhase, label?: string): string {
  switch (phase) {
    case "signing":
      return label ? `Sign ${label}` : "Sign transaction";
    case "confirming":
      return "Confirming on chain";
    case "success":
      return "Confirmed";
    case "denied":
      return "Transaction denied";
    case "error":
      return "Transaction failed";
    default:
      return "";
  }
}

function phaseSubtitle(phase: TxModalPhase): string | null {
  switch (phase) {
    case "signing":
      return "Approve in your wallet to continue";
    case "confirming":
      return "Waiting for Surfpool confirmation…";
    default:
      return null;
  }
}

function Spinner() {
  return (
    <svg
      className="tx-modal-spinner"
      viewBox="0 0 44 44"
      aria-hidden
    >
      <circle
        className="tx-modal-spinner-track"
        cx="22"
        cy="22"
        r="18"
        fill="none"
        strokeWidth="3"
      />
      <circle
        className="tx-modal-spinner-arc"
        cx="22"
        cy="22"
        r="18"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="48 65"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="tx-modal-result-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="tx-modal-result-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function TxConfirmModal() {
  const { open, phase, label, hint, error } = useSyncExternalStore(
    subscribeTxModal,
    getTxModalState,
    getTxModalState
  );

  const active = open && phase !== "idle";

  useEffect(() => {
    document.body.classList.toggle("tx-modal-open", active);
    return () => document.body.classList.remove("tx-modal-open");
  }, [active]);

  if (!active) return null;

  const busy = phase === "signing" || phase === "confirming";
  const success = phase === "success";
  const denied = phase === "denied";
  const failed = phase === "error";
  const subtitle =
    denied
      ? "You declined the signature in your wallet"
      : phaseSubtitle(phase);

  return createPortal(
    <>
      <div className="tx-modal-backdrop" aria-hidden />
      <div
        className="tx-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-label={phaseTitle(phase, label)}
      >
        <div className="tx-modal-card">
        <div
          className={[
            "tx-modal-icon",
            busy ? "tx-modal-icon--busy" : "",
            success ? "tx-modal-icon--success" : "",
            denied ? "tx-modal-icon--denied" : "",
            failed ? "tx-modal-icon--error" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {busy && <Spinner />}
          {success && <CheckIcon />}
          {(denied || failed) && <XIcon />}
        </div>
        <p className="tx-modal-title">{phaseTitle(phase, label)}</p>
        {subtitle && <p className="tx-modal-subtitle">{subtitle}</p>}
        {hint && busy && <p className="tx-modal-hint">{hint}</p>}
        {error && (denied || failed) && (
          <p className={denied ? "tx-modal-denied-msg" : "tx-modal-error"}>
            {error}
          </p>
        )}
        </div>
      </div>
    </>,
    document.body
  );
}
