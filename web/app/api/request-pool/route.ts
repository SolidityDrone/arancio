import { NextResponse } from "next/server";
import {
  handleRequestPool,
  type LaunchRequest,
} from "@/server/launch-service";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LaunchRequest;
    const result = await handleRequestPool(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("request-pool error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
