/**
 * Fund a Surfpool (Surfnet) wallet with SOL + curated xStock balances for desk testing.
 *
 * Usage:
 *   ./scripts/fund-surfpool-wallet.sh <PHANTOM_PUBKEY>
 *   ARANCIO_FUND_WALLET=<pubkey> ./scripts/fund-surfpool-wallet.sh
 */
import * as fs from "fs";
import * as path from "path";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

type DeskMarket = { symbol: string; mint: string };

/** Keep in sync with web/src/lib/markets.ts (regenerate via markets.ts grep if needed). */
const DESK_MARKETS: DeskMarket[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "desk-xstock-mints.json"), "utf8")
);

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Circle USDC — mainnet / Surfpool mainnet fork (same as web/src/lib/meteora-dbc.ts). */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type MintMeta = { decimals: number; programId: string };

function usage(): never {
  console.error(`Usage: fund-surfpool-wallet.sh <WALLET_PUBKEY>

Environment:
  ARANCIO_RPC_URL       RPC endpoint (default: http://127.0.0.1:8899)
  ARANCIO_FUND_WALLET   Wallet to fund (alternative to positional arg)
  ARANCIO_FUND_SOL      SOL ui amount for tx fees (default: 10)
  ARANCIO_FUND_USDC     USDC ui amount for DBC desk (default: 50000)
  ARANCIO_FUND_TOKENS   xStock ui amount per mint (default: 100)
  ARANCIO_FUND_SYMBOLS  Comma-separated subset, e.g. KOx,XOMx (default: all desk markets)

Requires Surfpool running on the RPC URL (surfnet cheatcodes).`);
  process.exit(1);
}

function uiToRaw(uiAmount: number, decimals: number): number {
  const [whole, frac = ""] = uiAmount.toString().split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Amount too large for JSON u64: ${raw.toString()}`);
  }
  return n;
}

async function surfnetRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { error?: { message?: string }; result?: T };
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result as T;
}

async function assertSurfpool(rpcUrl: string): Promise<void> {
  try {
    await surfnetRpc(rpcUrl, "getHealth", []);
  } catch (err) {
    throw new Error(
      `RPC ${rpcUrl} is not reachable. Start Surfpool first: ./scripts/start-surfpool.sh\n${err}`
    );
  }
}

async function fetchMintMeta(
  connection: Connection,
  mint: PublicKey,
  cache: Map<string, MintMeta>
): Promise<MintMeta> {
  const key = mint.toBase58();
  const cached = cache.get(key);
  if (cached) return cached;

  const info = await connection.getParsedAccountInfo(mint, "confirmed");
  const owner = info.value?.owner.toBase58();
  const parsed = (info.value?.data as { parsed?: { info?: { decimals?: number } } })
    ?.parsed?.info;
  const decimals = parsed?.decimals;
  if (decimals === undefined || !owner) {
    throw new Error(`Could not read mint ${key}`);
  }

  const programId =
    owner === TOKEN_2022_PROGRAM_ID ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const meta = { decimals, programId };
  cache.set(key, meta);
  return meta;
}

async function fundSol(
  rpcUrl: string,
  wallet: string,
  solAmount: number
): Promise<void> {
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
  await surfnetRpc(rpcUrl, "surfnet_setAccount", [
    wallet,
    { lamports },
  ]);
}

async function fundToken(
  rpcUrl: string,
  wallet: string,
  mint: string,
  uiAmount: number,
  meta: MintMeta
): Promise<void> {
  await surfnetRpc(rpcUrl, "surfnet_setTokenAccount", [
    wallet,
    mint,
    { amount: uiToRaw(uiAmount, meta.decimals) },
    meta.programId,
  ]);
}

async function main(): Promise<void> {
  const walletArg = process.argv[2] ?? process.env.ARANCIO_FUND_WALLET;
  if (!walletArg) usage();

  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletArg);
  } catch {
    console.error(`Invalid wallet pubkey: ${walletArg}`);
    usage();
  }

  const rpcUrl = process.env.ARANCIO_RPC_URL ?? "http://127.0.0.1:8899";
  const solAmount = Number(process.env.ARANCIO_FUND_SOL ?? "10");
  const usdcAmount = Number(process.env.ARANCIO_FUND_USDC ?? "50000");
  const tokenAmount = Number(process.env.ARANCIO_FUND_TOKENS ?? "100");
  const symbolFilter = (process.env.ARANCIO_FUND_SYMBOLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let markets = DESK_MARKETS;
  if (symbolFilter.length > 0) {
    const allowed = new Set(symbolFilter);
    markets = DESK_MARKETS.filter((m) => allowed.has(m.symbol));
    const missing = symbolFilter.filter(
      (sym) => !DESK_MARKETS.some((m) => m.symbol === sym)
    );
    if (missing.length > 0) {
      console.warn(`Unknown symbols (skipped): ${missing.join(", ")}`);
    }
    if (markets.length === 0) {
      throw new Error("No matching markets for ARANCIO_FUND_SYMBOLS");
    }
  }

  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    throw new Error("ARANCIO_FUND_SOL must be a positive number");
  }
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
    throw new Error("ARANCIO_FUND_TOKENS must be a positive number");
  }
  if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
    throw new Error("ARANCIO_FUND_USDC must be a positive number");
  }

  await assertSurfpool(rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const mintCache = new Map<string, MintMeta>();

  console.log(`Funding ${wallet.toBase58()} on ${rpcUrl}`);
  console.log(`  SOL (fees): ${solAmount}`);
  console.log(`  USDC (DBC): ${usdcAmount}`);
  console.log(`  xStocks: ${tokenAmount} each (${markets.length} mints)`);
  console.log("");

  process.stdout.write("SOL… ");
  await fundSol(rpcUrl, wallet.toBase58(), solAmount);
  console.log("ok");

  process.stdout.write("USDC… ");
  const usdcMeta = await fetchMintMeta(
    connection,
    new PublicKey(USDC_MINT),
    mintCache
  );
  await fundToken(rpcUrl, wallet.toBase58(), USDC_MINT, usdcAmount, usdcMeta);
  console.log("ok");

  for (const market of markets) {
    process.stdout.write(`${market.symbol}… `);
    const meta = await fetchMintMeta(connection, new PublicKey(market.mint), mintCache);
    await fundToken(rpcUrl, wallet.toBase58(), market.mint, tokenAmount, meta);
    console.log("ok");
  }

  const balance = await connection.getBalance(wallet, "confirmed");
  console.log("");
  console.log(`Done. SOL balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}`);
  console.log(
    "Refresh Phantom (Surfpool RPC) — USDC + xStock ATAs should appear in the desk."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
