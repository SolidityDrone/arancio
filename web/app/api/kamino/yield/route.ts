import { Connection, PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";
import { getLaunchConfig } from "@/server/launch-service";
import {
  fetchKaminoUsdcSnapshot,
  previewKaminoRedeem,
} from "@/lib/kamino-usdc";

export async function GET(req: NextRequest) {
  try {
    const cfg = getLaunchConfig();
    const connection = new Connection(cfg.rpcUrl, "confirmed");
    const snapshot = await fetchKaminoUsdcSnapshot(connection);
    const cRaw = req.nextUrl.searchParams.get("cTokenAmount");
    if (cRaw == null || cRaw === "") {
      return NextResponse.json({ ok: true, snapshot });
    }
    const cTokenAmount = BigInt(cRaw);
    const preview = await previewKaminoRedeem(connection, cTokenAmount);
    return NextResponse.json({
      ok: true,
      snapshot,
      preview: {
        cTokenAmount: preview.cTokenAmount.toString(),
        redeemableUsdc: preview.redeemableUsdc.toString(),
        accruedVsPar: preview.accruedVsPar.toString(),
        usdcPerCtoken: preview.usdcPerCtoken,
        supplyApy: preview.supplyApy,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
