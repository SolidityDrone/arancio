import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { simulateTransaction, type TxSimResult } from "./wallet-tx";

/** Human hint shown before Phantom opens when Surfpool simulation succeeds. */
export function formatSimHint(result: TxSimResult): string {
  if (!result.ok) return "";
  const cu =
    result.unitsConsumed != null
      ? ` · ~${Math.round(result.unitsConsumed / 1000)}k CU`
      : "";
  const changes = result.changesSummary
    ? ` · ${result.changesSummary}`
    : "";
  return `Surfpool sim OK${changes}${cu}`;
}

/** Best-effort check that Phantom is pointed at the same RPC as the app. */
export async function checkRpcReachable(rpcUrl: string): Promise<boolean> {
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    await connection.getLatestBlockhash("confirmed");
    return true;
  } catch {
    return false;
  }
}

export function isLocalSurfpoolRpc(endpoint: string): boolean {
  const e = endpoint.toLowerCase();
  return e.includes("127.0.0.1") || e.includes("localhost");
}

/** Short copy for the desk when Phantom cannot preview local mints. */
export function localWalletHint(endpoint: string): string | null {
  if (!isLocalSurfpoolRpc(endpoint)) return null;
  return (
    "Local Surfpool: Phantom → Settings → Developer → Testnet ON → custom RPC " +
    "http://127.0.0.1:8899 (same as this app). We simulate txs on Surfpool before the wallet opens."
  );
}

export async function previewTransaction(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey
): Promise<string> {
  const sim = await simulateTransaction(connection, tx, feePayer);
  return formatSimHint(sim);
}
