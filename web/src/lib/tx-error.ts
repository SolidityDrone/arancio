/** Wallet-standard user rejection (Phantom, Solflare, etc.). */
export const WALLET_USER_REJECTED_CODE = 4001;

const DENIED_PATTERN =
  /user rejected|rejected the request|transaction cancelled|transaction canceled|signature declined|approval denied|request rejected|denied|declined|cancelled signing|canceled signing|user cancelled|user canceled|wallet rejected|signing was cancelled|signing was canceled|action cancelled|action canceled/i;

function collectErrorStrings(err: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();

  function walk(value: unknown) {
    if (value == null || seen.has(value)) return;
    seen.add(value);

    if (typeof value === "string") {
      out.push(value);
      return;
    }

    if (value instanceof Error) {
      out.push(value.message);
      if (value.cause) walk(value.cause);
      return;
    }

    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.message === "string") out.push(obj.message);
      if (typeof obj.msg === "string") out.push(obj.msg);
      if (obj.code != null) out.push(String(obj.code));
      if (obj.error) walk(obj.error);
      if (obj.cause) walk(obj.cause);
      if (obj.reason) walk(obj.reason);
    }
  }

  walk(err);
  return out;
}

function hasRejectedCode(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const codes = new Set<string>();

  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (obj.code != null) codes.add(String(obj.code));
    if (obj.error) walk(obj.error);
    if (obj.cause) walk(obj.cause);
  }

  walk(err);
  return (
    codes.has(String(WALLET_USER_REJECTED_CODE)) ||
    codes.has("UserRejected")
  );
}

/** True when the user closed or rejected the wallet signature prompt. */
export function isTxDenied(err: unknown): boolean {
  if (hasRejectedCode(err)) return true;
  return collectErrorStrings(err).some((s) => DENIED_PATTERN.test(s));
}

export class TxDeniedError extends Error {
  readonly denied = true;

  constructor(message = "Transaction denied in wallet") {
    super(message);
    this.name = "TxDeniedError";
  }
}

/** Normalize wallet / RPC errors for status text and the tx modal. */
export function formatTxError(err: unknown): string {
  if (isTxDenied(err)) {
    return "Transaction denied — signature not approved in wallet";
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (msg.length > 140) return `${msg.slice(0, 137)}…`;
  return msg;
}
