/**
 * Browser-safe Kamino helpers — talk to Next `/api/kamino/*` so klend-sdk
 * (Node `fs`) never enters the client bundle.
 */
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  type KaminoRedeemPreview,
  type KaminoUsdcSnapshot,
} from "./kamino-usdc-config";

export type SerializedIx = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  dataBase64: string;
};

function ixsToTx(ixs: SerializedIx[], feePayer: PublicKey): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  for (const ix of ixs) {
    tx.add({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map((k) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.dataBase64, "base64"),
    });
  }
  return tx;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (json as { error?: string }).error ?? `Kamino API ${res.status}`
    );
  }
  return json;
}

export async function fetchKaminoUsdcSnapshotBrowser(): Promise<KaminoUsdcSnapshot> {
  const res = await fetch("/api/kamino/yield");
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    snapshot?: KaminoUsdcSnapshot;
  };
  if (!res.ok || !json.snapshot) {
    throw new Error(json.error ?? `Kamino yield ${res.status}`);
  }
  return json.snapshot;
}

export async function previewKaminoRedeemBrowser(
  cTokenAmount: bigint
): Promise<KaminoRedeemPreview> {
  const res = await fetch(
    `/api/kamino/yield?cTokenAmount=${cTokenAmount.toString()}`
  );
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    preview?: {
      cTokenAmount: string;
      redeemableUsdc: string;
      accruedVsPar: string;
      usdcPerCtoken: number;
      supplyApy: number;
    };
    snapshot?: KaminoUsdcSnapshot;
  };
  if (!res.ok || !json.preview) {
    throw new Error(json.error ?? `Kamino preview ${res.status}`);
  }
  const p = json.preview;
  return {
    cTokenAmount: BigInt(p.cTokenAmount),
    redeemableUsdc: BigInt(p.redeemableUsdc),
    accruedVsPar: BigInt(p.accruedVsPar),
    usdcPerCtoken: p.usdcPerCtoken,
    supplyApy: p.supplyApy,
  };
}

export async function buildKaminoDepositTransactionBrowser(
  user: PublicKey,
  usdcAmount: bigint
): Promise<Transaction> {
  const json = await postJson<{ instructions: SerializedIx[] }>(
    "/api/kamino/deposit-ix",
    { wallet: user.toBase58(), amount: usdcAmount.toString() }
  );
  return ixsToTx(json.instructions, user);
}

export async function buildKaminoRedeemTransactionBrowser(
  user: PublicKey,
  cTokenAmount: bigint
): Promise<Transaction> {
  const json = await postJson<{ instructions: SerializedIx[] }>(
    "/api/kamino/redeem-ix",
    { wallet: user.toBase58(), amount: cTokenAmount.toString() }
  );
  return ixsToTx(json.instructions, user);
}
