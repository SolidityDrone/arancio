import { Connection, PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { getLaunchConfig } from "@/server/launch-service";
import {
  buildKaminoDepositTransaction,
  transactionToSerializedIxs,
} from "@/lib/kamino-usdc";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { wallet?: string; amount?: string };
    if (!body.wallet || !body.amount) {
      return NextResponse.json(
        { ok: false, error: "wallet and amount required" },
        { status: 400 }
      );
    }
    const cfg = getLaunchConfig();
    const connection = new Connection(cfg.rpcUrl, "confirmed");
    const user = new PublicKey(body.wallet);
    const amount = BigInt(body.amount);
    const tx = await buildKaminoDepositTransaction(connection, user, amount);
    return NextResponse.json({
      ok: true,
      instructions: transactionToSerializedIxs(tx),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
