import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SendOptions,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { formatSimHint } from "./tx-preview";
import { formatTxError, isTxDenied, TxDeniedError } from "./tx-error";
import { getTxModalState, txModal } from "./tx-modal-store";

type Simulatable = Transaction | VersionedTransaction;

export type TxSimResult = {
  ok: boolean;
  err: unknown | null;
  unitsConsumed?: number;
  logTail?: string;
  /** e.g. "−0.01 SOL · +242670 YT" */
  changesSummary?: string;
};

function isVersioned(tx: Simulatable): tx is VersionedTransaction {
  return "version" in tx;
}

async function refreshBlockhash(
  connection: Connection,
  tx: Transaction
): Promise<void> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
}

/** Set fee payer + blockhash — required before simulate or sign. */
export async function prepareLegacyTransaction(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey
): Promise<void> {
  tx.feePayer = feePayer;
  await refreshBlockhash(connection, tx);
}

function formatTokenDelta(raw: bigint, decimals: number, mint: string): string {
  const sign = raw < 0n ? "−" : "+";
  const abs = raw < 0n ? -raw : raw;
  const padded = abs.toString(10).padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  const ui = frac ? `${whole}.${frac}` : whole;
  const mintShort = mint.slice(0, 4);
  return `${sign}${ui} ${mintShort}…`;
}

function summarizeSimChanges(
  tx: Transaction,
  feePayer: PublicKey,
  sim: {
    preBalances?: number[] | null;
    postBalances?: number[] | null;
    preTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      uiTokenAmount: { amount: string; decimals: number };
    }> | null;
    postTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      uiTokenAmount: { amount: string; decimals: number };
    }> | null;
  }
): string | undefined {
  const parts: string[] = [];
  const keys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
  const payerIdx = keys.findIndex((k) => k === feePayer.toBase58());

  if (
    payerIdx >= 0 &&
    sim.preBalances?.[payerIdx] != null &&
    sim.postBalances?.[payerIdx] != null
  ) {
    const lamports = sim.postBalances[payerIdx] - sim.preBalances[payerIdx];
    if (lamports !== 0) {
      const sol = Math.abs(lamports) / LAMPORTS_PER_SOL;
      parts.push(`${lamports < 0 ? "−" : "+"}${sol.toFixed(4)} SOL`);
    }
  }

  const preMap = new Map(
    (sim.preTokenBalances ?? []).map((b) => [
      `${b.accountIndex}:${b.mint}`,
      b,
    ])
  );
  for (const post of sim.postTokenBalances ?? []) {
    const key = `${post.accountIndex}:${post.mint}`;
    const pre = preMap.get(key);
    const preRaw = BigInt(pre?.uiTokenAmount.amount ?? "0");
    const postRaw = BigInt(post.uiTokenAmount.amount);
    const delta = postRaw - preRaw;
    if (delta !== 0n) {
      parts.push(
        formatTokenDelta(delta, post.uiTokenAmount.decimals, post.mint)
      );
    }
  }

  return parts.length ? parts.join(" · ") : undefined;
}

/** Simulate on Surfpool before opening the wallet popup. */
export async function simulateTransaction(
  connection: Connection,
  tx: Simulatable,
  feePayer?: PublicKey
): Promise<TxSimResult> {
  if (!isVersioned(tx)) {
    if (!tx.feePayer && feePayer) {
      await prepareLegacyTransaction(connection, tx, feePayer);
    } else if (!tx.feePayer) {
      throw new Error(
        "Transaction fee payer required — connect wallet and retry."
      );
    } else if (!tx.recentBlockhash) {
      await refreshBlockhash(connection, tx);
    }
  }

  const sim = isVersioned(tx)
    ? await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
    : await connection.simulateTransaction(tx, undefined, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

  const logs = sim.value.logs ?? [];
  const payer = !isVersioned(tx)
    ? (tx.feePayer ?? feePayer)
    : feePayer;

  return {
    ok: sim.value.err == null,
    err: sim.value.err ?? null,
    unitsConsumed: sim.value.unitsConsumed,
    logTail: logs.slice(-8).join("\n"),
    changesSummary:
      payer && !isVersioned(tx)
        ? summarizeSimChanges(tx, payer, sim.value)
        : undefined,
  };
}

export async function simulateOrThrow(
  connection: Connection,
  tx: Simulatable,
  feePayer?: PublicKey
): Promise<TxSimResult> {
  const result = await simulateTransaction(connection, tx, feePayer);
  if (!result.ok) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(result.err)}${
        result.logTail ? `\n${result.logTail}` : ""
      }`
    );
  }
  return result;
}

type SendableWallet = {
  publicKey: PublicKey | null;
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: SendOptions
  ) => Promise<string>;
};

export type SendCheckedOptions = SendOptions & {
  /** Called after Surfpool sim passes, before the wallet popup. */
  beforeWallet?: (sim: TxSimResult) => void;
  /** Short label for the signing modal, e.g. "split" or "swap". */
  modalLabel?: string;
  /** Wait for on-chain confirmation and animate success/failure. Default true. */
  waitForConfirmation?: boolean;
  /** Skip the full-screen signing modal. */
  skipModal?: boolean;
  /**
   * Ephemeral co-signers (e.g. DBC config + base mint keypairs).
   * Passed to the wallet adapter as `signers` after the final blockhash refresh —
   * do not partialSign before sendTransactionChecked or signatures go stale.
   */
  extraSigners?: Keypair[];
};

async function finishTxModalError(err: unknown, skipModal: boolean): Promise<void> {
  if (skipModal) return;
  if (isTxDenied(err)) {
    await txModal.finishDenied();
    return;
  }
  await txModal.finishError(formatTxError(err));
}

/**
 * Simulate on Surfpool, then send via the wallet adapter.
 * Phantom/Solflare use signAndSendTransaction — do not bypass with signTransaction + sendRaw.
 */
export async function sendTransactionChecked(
  connection: Connection,
  tx: Transaction,
  wallet: SendableWallet,
  options?: SendCheckedOptions
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");

  const {
    beforeWallet,
    modalLabel,
    waitForConfirmation = true,
    skipModal = false,
    extraSigners,
    ...sendOpts
  } = options ?? {};

  await prepareLegacyTransaction(connection, tx, wallet.publicKey);
  const sim = await simulateOrThrow(connection, tx);
  const simHint = formatSimHint(sim);

  if (!skipModal) {
    txModal.showSigning(modalLabel, simHint || undefined);
  }
  beforeWallet?.(sim);

  // Fresh blockhash right before wallet signAndSend (adapter refreshes again too).
  await refreshBlockhash(connection, tx);

  let sig: string;
  try {
    sig = await wallet.sendTransaction(tx, connection, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
      ...sendOpts,
      ...(extraSigners?.length ? { signers: extraSigners } : {}),
    });
  } catch (err) {
    await finishTxModalError(err, skipModal);
    throw isTxDenied(err) ? new TxDeniedError() : err;
  }

  if (waitForConfirmation) {
    if (!skipModal) txModal.showConfirming();
    try {
      const confirmation = await connection.confirmTransaction(
        sig,
        "confirmed"
      );
      if (confirmation.value.err) {
        const msg = `On-chain error: ${JSON.stringify(confirmation.value.err)}`;
        if (!skipModal) await txModal.finishError(msg);
        throw new Error(msg);
      }
    } catch (err) {
      const phase = getTxModalState().phase;
      if (!skipModal && phase !== "error" && phase !== "denied") {
        await finishTxModalError(err, false);
      }
      throw isTxDenied(err) ? new TxDeniedError() : err;
    }
  }

  if (!skipModal) await txModal.finishSuccess();
  return sig;
}
