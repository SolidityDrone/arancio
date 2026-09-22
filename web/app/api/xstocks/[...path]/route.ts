import { NextResponse } from "next/server";

const UPSTREAM = "https://api.xstocks.fi/api/v2/public";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const { search } = new URL(request.url);
  const segment = path.map(encodeURIComponent).join("/");
  const upstream = `${UPSTREAM}/${segment}${search}`;

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
