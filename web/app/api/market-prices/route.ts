import { NextResponse } from "next/server";
import { fetchPricesUsd } from "@/lib/xstocks-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols")?.trim();
  if (!raw) {
    return NextResponse.json({ error: "symbols required" }, { status: 400 });
  }
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "symbols required" }, { status: 400 });
  }
  try {
    const prices = await fetchPricesUsd(symbols);
    return NextResponse.json(prices, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
