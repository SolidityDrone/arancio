import { NextResponse } from "next/server";
import { fetchMarketQuotes } from "@/lib/xstocks-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  try {
    const quotes = await fetchMarketQuotes(symbol);
    return NextResponse.json(quotes, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("market-intel error:", symbol, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
