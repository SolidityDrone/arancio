export type TxModalPhase =
  | "idle"
  | "signing"
  | "confirming"
  | "success"
  | "denied"
  | "error";

export type TxModalState = {
  open: boolean;
  phase: TxModalPhase;
  label?: string;
  hint?: string;
  error?: string;
};

let state: TxModalState = { open: false, phase: "idle" };
const listeners = new Set<() => void>();

function syncBodyLock() {
  if (typeof document === "undefined") return;
  const active = state.open && state.phase !== "idle";
  document.body.classList.toggle("tx-modal-open", active);
}

function emit() {
  syncBodyLock();
  listeners.forEach((fn) => fn());
}

function patch(partial: Partial<TxModalState>) {
  state = { ...state, ...partial };
  emit();
}

export function subscribeTxModal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTxModalState(): TxModalState {
  return state;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const txModal = {
  showSigning(label?: string, hint?: string) {
    patch({
      open: true,
      phase: "signing",
      label,
      hint,
      error: undefined,
    });
  },

  showConfirming() {
    patch({ phase: "confirming", error: undefined });
  },

  showSuccess() {
    patch({ phase: "success", error: undefined });
  },

  showDenied(message?: string) {
    patch({
      phase: "denied",
      error: message ?? "Signature declined in your wallet",
    });
  },

  showError(message: string) {
    patch({ phase: "error", error: message });
  },

  hide() {
    patch({
      open: false,
      phase: "idle",
      label: undefined,
      hint: undefined,
      error: undefined,
    });
  },

  async finishSuccess(dwellMs = 1600) {
    this.showSuccess();
    await sleep(dwellMs);
    this.hide();
  },

  async finishDenied(message?: string, dwellMs = 1800) {
    this.showDenied(message);
    await sleep(dwellMs);
    this.hide();
  },

  async finishError(message: string, dwellMs = 2200) {
    this.showError(message);
    await sleep(dwellMs);
    this.hide();
  },
};
