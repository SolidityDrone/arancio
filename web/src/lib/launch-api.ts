import type { StoredLaunch } from "./meteora-dbc";

/** Empty = same origin `/api/*`. Set only for a remote launch API. */
export const LAUNCH_API_URL = process.env.NEXT_PUBLIC_LAUNCH_API_URL ?? "";

export type PoolLaunchRequest = {
  mint: string;
  symbol: string;
  yieldNonce: number;
  fairCoupon: number;
  avgDistributionUsd?: number;
};

export type PoolLaunchResponse = {
  ok?: boolean;
  pool?: string;
  baseMint?: string;
  quoteMint?: string;
  config?: string;
  initialMarketCapUsd?: number;
  migrationMarketCapUsd?: number;
  fairCoupon?: number;
  avgDistributionUsd?: number;
  launchSignature?: string;
  registerSignature?: string;
  error?: string;
  executorStatus?: string;
};

function normalizeCreFields(raw: Record<string, unknown>): PoolLaunchResponse {
  const pick = (camel: keyof PoolLaunchResponse, pascal: string) =>
    (raw[camel] ?? raw[pascal]) as PoolLaunchResponse[keyof PoolLaunchResponse];
  return {
    ok: Boolean(pick("ok", "OK")),
    pool: pick("pool", "Pool") as string | undefined,
    baseMint: pick("baseMint", "BaseMint") as string | undefined,
    quoteMint: pick("quoteMint", "QuoteMint") as string | undefined,
    config: pick("config", "Config") as string | undefined,
    initialMarketCapUsd: pick("initialMarketCapUsd", "InitialMarketCapUsd") as
      | number
      | undefined,
    migrationMarketCapUsd: pick(
      "migrationMarketCapUsd",
      "MigrationMarketCapUsd"
    ) as number | undefined,
    fairCoupon: pick("fairCoupon", "FairCoupon") as number | undefined,
    avgDistributionUsd: pick("avgDistributionUsd", "AvgDistributionUsd") as
      | number
      | undefined,
    launchSignature: pick("launchSignature", "LaunchSignature") as
      | string
      | undefined,
    registerSignature: pick("registerSignature", "RegisterSignature") as
      | string
      | undefined,
    executorStatus: pick("executorStatus", "ExecutorStatus") as
      | string
      | undefined,
  };
}

function unwrapCreBody(body: Record<string, unknown>): PoolLaunchResponse {
  const nested = body.output ?? body.result ?? body.data;
  const base =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : body;
  const launch = normalizeCreFields(base);
  if (launch.pool && launch.baseMint) launch.ok = true;
  return launch;
}

/** Ask Next.js /api/request-pool → policy + on-chain Meteora launch. */
export async function requestPoolLaunch(
  req: PoolLaunchRequest
): Promise<PoolLaunchResponse> {
  const base = LAUNCH_API_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/request-pool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = (await res.json()) as Record<string, unknown> & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Launch API ${res.status}`);
  }
  const launch = unwrapCreBody(body);
  if (launch.pool && launch.baseMint) {
    launch.ok = true;
  }
  return launch;
}

export function storedLaunchFromApi(
  req: PoolLaunchRequest,
  res: PoolLaunchResponse
): StoredLaunch | null {
  if (!res.pool || !res.baseMint) return null;
  return {
    symbol: req.symbol,
    yieldNonce: req.yieldNonce,
    fairCoupon: res.fairCoupon ?? req.fairCoupon,
    config: res.config ?? "",
    pool: res.pool,
    baseMint: res.baseMint,
    quoteMint: res.quoteMint ?? "",
    initialMarketCap: res.initialMarketCapUsd ?? 5_000,
    migrationMarketCap: res.migrationMarketCapUsd ?? 75_000,
    launchedAt: Date.now(),
    launchSignature: res.launchSignature,
  };
}
