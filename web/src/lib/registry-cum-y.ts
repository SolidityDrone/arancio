import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@anchor-lang/core";
import registryIdl from "./ca_registry.json";
import { CA_REGISTRY_PROGRAM_ID, MULTIPLIER_SCALE } from "./markets";
import { registryPda } from "./seed-registry";

const REGISTRY_PROGRAM = new PublicKey(CA_REGISTRY_PROGRAM_ID);

function readSeriesCumYStart(data: Buffer): bigint {
  // StripSeries layout after discriminator: market(32) + underlying(32) + start(4) + target(4) + pt(32) + yt(32) + cum_y_start(8)
  const offset = 8 + 32 + 32 + 4 + 4 + 32 + 32;
  return data.readBigUInt64LE(offset);
}

export async function fetchCumYAtNonce(
  connection: Connection,
  mint: PublicKey,
  nonce: number
): Promise<bigint> {
  const registry = registryPda(mint);
  const program = new Program(registryIdl as never, { connection });
  try {
    const event = await program.methods
      .eventAtYieldNonce(nonce)
      .accounts({ registry })
      .view();
    const cum = BigInt((event as { cumY?: { toString(): string } }).cumY?.toString() ?? "0");
    return cum > 0n ? cum : MULTIPLIER_SCALE;
  } catch {
    return MULTIPLIER_SCALE;
  }
}

export async function fetchWindowCumYs(
  connection: Connection,
  mint: PublicKey,
  start: number,
  target: number,
  seriesAccount?: Buffer | null
): Promise<{ cumStart: bigint; cumTarget: bigint }> {
  let cumStart = 0n;
  if (seriesAccount) {
    cumStart = readSeriesCumYStart(seriesAccount);
  }
  if (cumStart <= 0n) {
    cumStart = await fetchCumYAtNonce(connection, mint, start);
  }
  const cumTarget = await fetchCumYAtNonce(connection, mint, target);
  return { cumStart, cumTarget };
}
