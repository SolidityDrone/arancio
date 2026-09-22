import { NextResponse } from "next/server";
import {
  executeLaunch,
  type ExecutorPayload,
} from "@/server/launch-service";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ExecutorPayload;
    const result = await executeLaunch(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("execute error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
