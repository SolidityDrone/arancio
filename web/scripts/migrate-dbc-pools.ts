/**
 * Poll DBC pools and migrate completed curves to DAMM v2.
 *
 * Usage:
 *   cd web && npx --yes tsx scripts/migrate-dbc-pools.ts [poolPubkey...]
 *   ARANCIO_POOLS=addr1,addr2 npx --yes tsx scripts/migrate-dbc-pools.ts
 *   ARANCIO_MIGRATE_INTERVAL_MS=15000 npx --yes tsx scripts/migrate-dbc-pools.ts --watch
 *
 * Environment:
 *   ARANCIO_RPC_URL           default http://127.0.0.1:8899
 *   SOLANA_KEYPAIR_PATH       launch authority (default ~/.config/solana/id.json)
 *   ARANCIO_POOLS             comma-separated pool addresses
 *   ARANCIO_MIGRATE_INTERVAL_MS  poll interval with --watch (default 30000)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  buildMigrateToDammV2Tx,
  DEFAULT_DAMM_V2_CONFIG,
  fetchPoolProgress,
} from "../src/lib/meteora-dbc";

const RPC = process.env.ARANCIO_RPC_URL ?? "http://127.0.0.1:8899";
const INTERVAL = Number(process.env.ARANCIO_MIGRATE_INTERVAL_MS ?? "30000");
const PROGRESS_EPS = 0.999;

function loadKeypair(): Keypair {
  const kpPath =
    process.env.SOLANA_KEYPAIR_PATH ??
    path.join(os.homedir(), ".config/solana/id.json");
  const raw = JSON.parse(fs.readFileSync(kpPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function resolvePools(argv: string[]): PublicKey[] {
  const fromEnv = (process.env.ARANCIO_POOLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const addrs = [...argv.filter((a) => !a.startsWith("-")), ...fromEnv];
  if (addrs.length === 0) {
    console.error(
      "Provide pool address(es) as args or ARANCIO_POOLS=addr1,addr2"
    );
    process.exit(1);
  }
  return addrs.map((a) => new PublicKey(a));
}

async function migrateOne(
  connection: Connection,
  payer: Keypair,
  pool: PublicKey
): Promise<"skipped" | "migrated" | "waiting"> {
  const progress = await fetchPoolProgress(connection, pool);
  if (!progress) {
    console.log(`[skip] ${pool.toBase58()} — pool not found`);
    return "skipped";
  }
  if (progress.isMigrated) {
    console.log(`[ok] ${pool.toBase58()} — already migrated`);
    return "skipped";
  }
  if (progress.quoteProgress < PROGRESS_EPS) {
    console.log(
      `[wait] ${pool.toBase58()} — fill ${(progress.quoteProgress * 100).toFixed(1)}%`
    );
    return "waiting";
  }

  const built = await buildMigrateToDammV2Tx({
    connection,
    payer: payer.publicKey,
    pool,
    dammConfig: DEFAULT_DAMM_V2_CONFIG,
  });
  if (!built) {
    console.error(`[err] ${pool.toBase58()} — could not build migration tx`);
    return "skipped";
  }

  built.transaction.feePayer = payer.publicKey;
  const sig = await sendAndConfirmTransaction(
    connection,
    built.transaction,
    [payer, ...built.signers],
    { commitment: "confirmed" }
  );
  console.log(`[migrate] ${pool.toBase58()} → DAMM v2 · ${sig}`);
  return "migrated";
}

async function runOnce(pools: PublicKey[]) {
  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair();
  console.log(`RPC ${RPC} · payer ${payer.publicKey.toBase58()}`);
  for (const pool of pools) {
    try {
      await migrateOne(connection, payer, pool);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[err] ${pool.toBase58()} — ${msg}`);
    }
  }
}

async function main() {
  const watch = process.argv.includes("--watch");
  const pools = resolvePools(process.argv.slice(2));
  if (watch) {
    console.log(`Watching ${pools.length} pool(s) every ${INTERVAL}ms`);
    for (;;) {
      await runOnce(pools);
      await new Promise((r) => setTimeout(r, INTERVAL));
    }
  }
  await runOnce(pools);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
