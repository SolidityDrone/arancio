import { NextResponse } from "next/server";
import { fetchCorporateActions } from "@/lib/xstocks-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  try {
    const ca = await fetchCorporateActions(symbol);
    return NextResponse.json(ca, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("market-ca error:", symbol, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
