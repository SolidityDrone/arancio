import { NextResponse } from "next/server";
import { getLaunchConfig } from "@/server/launch-service";

export async function GET() {
  const cfg = getLaunchConfig();
  return NextResponse.json({
    ok: true,
    rpc: cfg.rpcUrl,
  });
}
