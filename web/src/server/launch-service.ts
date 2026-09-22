/**
 * Pool launch — Next.js `/api/request-pool` (+ optional `launch-backend.ts`).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  buildLaunchYtOnDbc,
  DEFAULT_QUOTE_MINT,
  refreshTransactionBlockhash,
  type StoredLaunch,
} from "../lib/meteora-dbc";
import {
  buildEnsureStripSeriesTransaction,
  buildPrepareAndInitVaultTransaction,
  buildRegisterCurveLaunchTransaction,
} from "../lib/strip-vault-tx";
import { computeCurvePolicy } from "../lib/curve-policy";

export type LaunchRequest = {
  mint: string;
  symbol: string;
  yieldNonce?: number;
  /** @deprecated Legacy window API — treated as yieldNonce. */
  startNonce?: number;
  targetNonce?: number;
  fairCoupon?: number;
  avgDistributionUsd?: number;
};

export type ExecutorPayload = LaunchRequest & {
  totalTokenSupply?: number;
  initialMarketCapUsd?: number;
  migrationMarketCapUsd?: number;
  launchFairPpm?: number;
};

export type LaunchConfig = {
  rpcUrl: string;
};

export function getLaunchConfig(): LaunchConfig {
  return {
    rpcUrl: process.env.ARANCIO_RPC_URL ?? "http://127.0.0.1:8899",
  };
}

export function resolveYieldNonce(body: LaunchRequest): number {
  if (body.yieldNonce != null && Number.isFinite(body.yieldNonce)) {
    return body.yieldNonce;
  }
  if (body.startNonce != null && Number.isFinite(body.startNonce)) {
    return body.startNonce;
  }
  throw new Error("yieldNonce required");
}

/** Authority keypair — JSON secret on Vercel, file path for local dev. */
export function loadAuthorityKeypair(): Keypair {
  const json = process.env.SOLANA_KEYPAIR_JSON?.trim();
  if (json) {
    const raw = JSON.parse(json) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const keyPath =
    process.env.SOLANA_KEYPAIR_PATH ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function validateLaunchRequest(body: LaunchRequest): string | null {
  if (!body.mint || !body.symbol) return "mint and symbol required";
  try {
    resolveYieldNonce(body);
  } catch {
    return "yieldNonce required";
  }
  if (body.avgDistributionUsd == null || body.avgDistributionUsd <= 0) {
    return "avgDistributionUsd required — xStocks CashDividend history missing";
  }
  return null;
}

export function computeLaunchPolicy(
  body: LaunchRequest
): Record<string, unknown> {
  const avg = body.avgDistributionUsd!;
  const fair = body.fairCoupon ?? 0.02;
  const policy = computeCurvePolicy({
    avgDistributionUsd: avg,
    fairCoupon: fair,
  });
  return {
    ok: true,
    mint: body.mint,
    symbol: body.symbol,
    yieldNonce: resolveYieldNonce(body),
    fairCoupon: fair,
    avgDistributionUsd: avg,
    totalTokenSupply: policy.totalTokenSupply,
    initialMarketCapUsd: policy.initialMarketCapUsd,
    migrationMarketCapUsd: policy.migrationMarketCapUsd,
    launchFairPpm: policy.launchFairPpm,
  };
}

export async function executeLaunch(
  body: ExecutorPayload,
  cfg: LaunchConfig = getLaunchConfig()
) {
  const avg = body.avgDistributionUsd;
  if (avg == null || avg <= 0) {
    throw new Error(
      "avgDistributionUsd required — xStocks CashDividend history missing for curve pricing"
    );
  }
  const payer = loadAuthorityKeypair();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const underlyingMint = new PublicKey(body.mint);
  const yieldNonce = resolveYieldNonce(body);
  const fair = body.fairCoupon ?? 0.02;
  const symbol = body.symbol;

  const seriesRef = { underlyingMint, yieldNonce };

  const ensureTx = await buildEnsureStripSeriesTransaction(
    connection,
    payer.publicKey,
    seriesRef,
    symbol
  );
  if (ensureTx.instructions.length > 0) {
    ensureTx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(connection, ensureTx, [payer]);
  }

  const launch = await buildLaunchYtOnDbc({
    connection,
    payer: payer.publicKey,
    quoteMint: DEFAULT_QUOTE_MINT,
    launch: {
      symbol,
      yieldNonce,
      fairCoupon: fair,
      avgDistributionUsd: body.avgDistributionUsd,
    },
  });
  await sendAndConfirmTransaction(connection, launch.createConfigTx, [
    payer,
    launch.configKeypair,
  ]);
  await refreshTransactionBlockhash(
    connection,
    launch.createPoolTx,
    payer.publicKey
  );
  const launchSig = await sendAndConfirmTransaction(connection, launch.createPoolTx, [
    payer,
    launch.baseMintKeypair,
  ]);

  const registerTx = await buildRegisterCurveLaunchTransaction(
    connection,
    payer.publicKey,
    seriesRef,
    launch.baseMint,
    launch.pool,
    body.launchFairPpm ?? Math.round(fair * 1_000_000),
    body.initialMarketCapUsd ?? launch.initialMarketCap,
    body.migrationMarketCapUsd ?? launch.migrationMarketCap
  );
  registerTx.feePayer = payer.publicKey;
  const registerSig = await sendAndConfirmTransaction(connection, registerTx, [payer]);

  const vaultTx = await buildPrepareAndInitVaultTransaction(
    connection,
    payer.publicKey,
    seriesRef,
    launch.baseMint,
    symbol
  );
  let vaultInitSignature: string | undefined;
  if (vaultTx.instructions.length > 0) {
    vaultTx.feePayer = payer.publicKey;
    vaultInitSignature = await sendAndConfirmTransaction(connection, vaultTx, [
      payer,
    ]);
  }

  const stored: StoredLaunch = {
    symbol,
    yieldNonce,
    fairCoupon: fair,
    config: launch.config.toBase58(),
    pool: launch.pool.toBase58(),
    baseMint: launch.baseMint.toBase58(),
    quoteMint: launch.quoteMint.toBase58(),
    initialMarketCap: launch.initialMarketCap,
    migrationMarketCap: launch.migrationMarketCap,
    launchedAt: Date.now(),
    launchSignature: launchSig,
  };

  return {
    ok: true,
    symbol,
    yieldNonce,
    pool: stored.pool,
    baseMint: stored.baseMint,
    quoteMint: stored.quoteMint,
    config: stored.config,
    initialMarketCap: stored.initialMarketCap,
    migrationMarketCap: stored.migrationMarketCap,
    initialMarketCapUsd: stored.initialMarketCap,
    migrationMarketCapUsd: stored.migrationMarketCap,
    fairCoupon: fair,
    launchSignature: launchSig,
    registerSignature: registerSig,
    vaultInitSignature,
    storedLaunch: stored,
  };
}

/** Desk launch: curve policy → Meteora DBC + register_curve_launch. */
export async function handleRequestPool(body: LaunchRequest) {
  const validationError = validateLaunchRequest(body);
  if (validationError) {
    return { status: 400 as const, body: { ok: false, error: validationError } };
  }

  const cfg = getLaunchConfig();
  const policy = computeLaunchPolicy(body);
  const exec = await executeLaunch(
    {
      ...body,
      fairCoupon:
        (policy.fairCoupon as number | undefined) ?? body.fairCoupon ?? 0.02,
      launchFairPpm: policy.launchFairPpm as number | undefined,
      initialMarketCapUsd: policy.initialMarketCapUsd as number | undefined,
      migrationMarketCapUsd: policy.migrationMarketCapUsd as number | undefined,
      avgDistributionUsd:
        (policy.avgDistributionUsd as number | undefined) ??
        body.avgDistributionUsd,
    },
    cfg
  );

  return {
    status: 200 as const,
    body: { ...policy, ...exec, ok: true },
  };
}
