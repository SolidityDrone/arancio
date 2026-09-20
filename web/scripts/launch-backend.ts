/**
 * Desk launch backend: public API for the frontend + internal tx executor for CRE.
 *
 * Flow:
 *   Frontend POST /api/request-pool
 *     → CRE HTTP trigger (exec simulate by default, or --listen on :2000)
 *     → CRE computes CurvePolicy → POST /internal/execute (this server)
 *     → Meteora DBC + register_curve_launch (authority keypair)
 *
 * Usage:
 *   cd web && npx --yes tsx scripts/launch-backend.ts
 *
 * Environment:
 *   ARANCIO_RPC_URL              Surfpool RPC (default http://127.0.0.1:8899)
 *   ARANCIO_LAUNCH_BACKEND_PORT  Public API port (default 8788)
 *   ARANCIO_CRE_MODE             exec | listen (default exec)
 *   ARANCIO_CRE_HTTP_URL         CRE listen URL (default http://127.0.0.1:2000/trigger)
 *   ARANCIO_CRE_ROOT             cre/orange-cre path (auto-detected)
 *   SOLANA_KEYPAIR_PATH          Market authority (default ~/.config/solana/id.json)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  buildLaunchYtOnDbc,
  DEFAULT_QUOTE_MINT,
  type StoredLaunch,
} from "../src/lib/meteora-dbc";
import {
  buildEnsureStripWindowTransaction,
  buildRegisterCurveLaunchTransaction,
} from "../src/lib/strip-vault-tx";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const RPC = process.env.ARANCIO_RPC_URL ?? "http://127.0.0.1:8899";
const PORT = Number(process.env.ARANCIO_LAUNCH_BACKEND_PORT ?? "8788");
const CRE_MODE = process.env.ARANCIO_CRE_MODE ?? "exec";
const CRE_HTTP =
  process.env.ARANCIO_CRE_HTTP_URL ?? "http://127.0.0.1:2000/trigger";
const CRE_ROOT =
  process.env.ARANCIO_CRE_ROOT ??
  path.join(scriptDir, "../../cre/orange-cre");

type LaunchRequest = {
  mint: string;
  symbol: string;
  startNonce: number;
  targetNonce: number;
  fairCoupon?: number;
};

type ExecutorPayload = LaunchRequest & {
  lockNonces?: number;
  totalTokenSupply?: number;
  initialMarketCapUsd?: number;
  migrationMarketCapUsd?: number;
  launchFairPpm?: number;
};

function loadKeypair(): Keypair {
  const keyPath =
    process.env.SOLANA_KEYPAIR_PATH ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function executeLaunch(body: ExecutorPayload) {
  const payer = loadKeypair();
  const connection = new Connection(RPC, "confirmed");
  const underlyingMint = new PublicKey(body.mint);
  const start = body.startNonce;
  const target = body.targetNonce;
  const fair = body.fairCoupon ?? 0.02;
  const symbol = body.symbol;

  const stripWindow = { underlyingMint, startNonce: start, targetNonce: target };

  const ensureTx = await buildEnsureStripWindowTransaction(
    connection,
    payer.publicKey,
    stripWindow,
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
    window: { symbol, startNonce: start, targetNonce: target, fairCoupon: fair },
  });
  launch.transaction.feePayer = payer.publicKey;
  const launchSig = await sendAndConfirmTransaction(connection, launch.transaction, [
    payer,
    ...launch.signers,
  ]);

  const registerTx = await buildRegisterCurveLaunchTransaction(
    connection,
    payer.publicKey,
    stripWindow,
    launch.baseMint,
    launch.pool,
    body.launchFairPpm ?? Math.round(fair * 1_000_000),
    body.initialMarketCapUsd ?? launch.initialMarketCap,
    body.migrationMarketCapUsd ?? launch.migrationMarketCap
  );
  registerTx.feePayer = payer.publicKey;
  const registerSig = await sendAndConfirmTransaction(connection, registerTx, [payer]);

  const stored: StoredLaunch = {
    symbol,
    startNonce: start,
    targetNonce: target,
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
    pool: stored.pool,
    baseMint: stored.baseMint,
    quoteMint: stored.quoteMint,
    config: stored.config,
    initialMarketCap: stored.initialMarketCap,
    migrationMarketCap: stored.migrationMarketCap,
    fairCoupon: fair,
    launchSignature: launchSig,
    registerSignature: registerSig,
    storedLaunch: stored,
  };
}

function normalizeCreFields(raw: Record<string, unknown>): Record<string, unknown> {
  const pick = (camel: string, pascal: string) =>
    raw[camel] ?? raw[pascal];
  return {
    ok: pick("ok", "OK"),
    pool: pick("pool", "Pool"),
    baseMint: pick("baseMint", "BaseMint"),
    quoteMint: pick("quoteMint", "QuoteMint"),
    config: pick("config", "Config"),
    initialMarketCapUsd: pick("initialMarketCapUsd", "InitialMarketCapUsd"),
    migrationMarketCapUsd: pick("migrationMarketCapUsd", "MigrationMarketCapUsd"),
    fairCoupon: pick("fairCoupon", "FairCoupon"),
    launchFairPpm: pick("launchFairPpm", "LaunchFairPpm"),
    launchSignature: pick("launchSignature", "LaunchSignature"),
    registerSignature: pick("registerSignature", "RegisterSignature"),
    executorStatus: pick("executorStatus", "ExecutorStatus"),
    mint: pick("mint", "Mint"),
    symbol: pick("symbol", "Symbol"),
    startNonce: pick("startNonce", "StartNonce"),
    targetNonce: pick("targetNonce", "TargetNonce"),
  };
}

function unwrapCreResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw.output ?? raw.result ?? raw.data;
  const base =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : raw;
  return normalizeCreFields(base);
}

function parseCreSimStdout(stdout: string): Record<string, unknown> {
  const marker = "Workflow Simulation Result:";
  const idx = stdout.indexOf(marker);
  if (idx === -1) {
    throw new Error("CRE simulate missing Workflow Simulation Result");
  }
  const rest = stdout.slice(idx + marker.length);
  const start = rest.indexOf("{");
  const end = rest.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("CRE simulate output has no JSON result");
  }
  return unwrapCreResponse(
    JSON.parse(rest.slice(start, end + 1)) as Record<string, unknown>
  );
}

function forwardToCreExec(
  body: LaunchRequest,
  policyOnly = false
): Record<string, unknown> {
  const payloadPath = path.join(
    os.tmpdir(),
    `cre-launch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(payloadPath, JSON.stringify(body));
  const args = [
    "workflow",
    "simulate",
    "curve-yt-launch",
    "--non-interactive",
    "--trigger-index",
    "0",
    "--target",
    "staging-settings",
    "--http-payload",
    payloadPath,
  ];
  if (policyOnly) {
    args.splice(
      args.length - 2,
      0,
      "--config",
      path.join(CRE_ROOT, "curve-yt-launch/config.staging.norelay.json")
    );
  }
  try {
    const stdout = execFileSync(
      "cre",
      args,
      {
        cwd: CRE_ROOT,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    return parseCreSimStdout(stdout);
  } finally {
    fs.unlinkSync(payloadPath);
  }
}

async function forwardToCreListen(body: LaunchRequest): Promise<Record<string, unknown>> {
  const res = await fetch(CRE_HTTP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CRE HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!text.trim()) {
    throw new Error(
      "CRE listen returned empty body — use ARANCIO_CRE_MODE=exec or restart cre workflow simulate --listen"
    );
  }
  try {
    return unwrapCreResponse(JSON.parse(text) as Record<string, unknown>);
  } catch {
    return parseCreSimStdout(text);
  }
}

async function forwardToCre(body: LaunchRequest): Promise<Record<string, unknown>> {
  if (CRE_MODE === "listen") {
    return forwardToCreListen(body);
  }
  return forwardToCreExec(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/request-pool") {
    void (async () => {
      try {
        const body = await readJson<LaunchRequest>(req);
        if (!body.mint || !body.symbol) {
          sendJson(res, 400, { ok: false, error: "mint and symbol required" });
          return;
        }
        if (body.targetNonce <= body.startNonce) {
          sendJson(res, 400, { ok: false, error: "invalid window" });
          return;
        }
        const policy = forwardToCreExec(body, true);
        const exec = await executeLaunch({
          ...body,
          fairCoupon:
            (policy.fairCoupon as number | undefined) ?? body.fairCoupon ?? 0.02,
          launchFairPpm: policy.launchFairPpm as number | undefined,
          initialMarketCapUsd: policy.initialMarketCapUsd as number | undefined,
          migrationMarketCapUsd: policy.migrationMarketCapUsd as number | undefined,
        });
        sendJson(res, 200, { ...policy, ...exec, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("request-pool error:", message);
        sendJson(res, 502, { ok: false, error: message });
      }
    })();
    return;
  }

  if (req.method === "POST" && req.url === "/internal/execute") {
    void (async () => {
      try {
        const body = await readJson<ExecutorPayload>(req);
        const result = await executeLaunch(body);
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("execute error:", message);
        sendJson(res, 500, { ok: false, error: message });
      }
    })();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, rpc: RPC, creMode: CRE_MODE, cre: CRE_HTTP });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`launch backend http://127.0.0.1:${PORT}`);
  console.log(`  POST /api/request-pool  → CRE mode=${CRE_MODE}`);
  console.log(`  POST /internal/execute  → Meteora + register (${RPC})`);
  console.log(`  keypair: ${process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config/solana/id.json")}`);
});
