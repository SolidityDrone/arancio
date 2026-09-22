/**
 * Seed ca_registry PDAs for all desk xStocks (deploy keypair authority).
 * Invoked by ./scripts/deploy-surfpool.sh after program deploy.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { seedRegistryWithAuthority } from "../src/lib/seed-registry";

type DeskMarket = { symbol: string; mint: string };

function loadAuthorityKeypair(): Keypair {
  const json = process.env.SOLANA_KEYPAIR_JSON?.trim();
  if (json) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json) as number[]));
  }
  const keyPath =
    process.env.SOLANA_KEYPAIR_PATH ??
    process.env.ANCHOR_WALLET?.replace(/^~/, os.homedir()) ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function deskMarkets(): DeskMarket[] {
  const file = path.join(__dirname, "../../scripts/desk-xstock-mints.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as DeskMarket[];
}

function filterMarkets(all: DeskMarket[]): DeskMarket[] {
  const only = process.env.ARANCIO_SEED_SYMBOLS?.trim();
  if (!only) return all;
  const set = new Set(only.split(",").map((s) => s.trim()).filter(Boolean));
  return all.filter((m) => set.has(m.symbol));
}

async function main() {
  const rpcUrl = process.env.ARANCIO_RPC_URL ?? "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  const authority = loadAuthorityKeypair();
  const markets = filterMarkets(deskMarkets());

  console.log(`Seeding ca_registry on ${rpcUrl}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Markets: ${markets.length}`);

  let seeded = 0;
  for (const { symbol, mint } of markets) {
    const result = await seedRegistryWithAuthority({
      connection,
      authority,
      symbol,
      mint,
      onProgress: (msg) => console.log(`  ${msg}`),
    });
    if (result.eventCount >= 0) seeded += 1;
  }

  console.log(`Done — ${seeded}/${markets.length} registry PDAs checked.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
