import { sha1 } from "@noble/hashes/sha1";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@anchor-lang/core";
import { Connection } from "@solana/web3.js";
import registryIdl from "./ca_registry.json";
import { CA_REGISTRY_PROGRAM_ID, MULTIPLIER_SCALE } from "./markets";
import { fetchCaHistory, type CorporateAction } from "./xstocks-api";

const REGISTRY_PROGRAM = new PublicKey(CA_REGISTRY_PROGRAM_ID);
const MOCK_FORWARDER = new PublicKey(
  "jhCjuD4Z3V7HeSUChMRpkRwpw6B9yC63mxDMv8SdLNX"
);

const KIND_YIELD = 0;
const KIND_SUPPLY = 1;
const KIND_OTHER = 2;

function hashEventId(eventId: string): Uint8Array {
  return sha1(new TextEncoder().encode(eventId)).subarray(0, 16);
}

function parseMultiplier(value: string | null | undefined): bigint {
  if (!value) return 0n;
  return BigInt(Math.trunc(Number(value) * Number(MULTIPLIER_SCALE)));
}

function caTypeFromString(caType: string): number {
  switch (caType) {
    case "CashDividend":
      return 0;
    case "ForwardSplit":
      return 1;
    case "ReverseSplit":
      return 2;
    case "StockDividend":
      return 3;
    case "SpinOff":
      return 4;
    default:
      throw new Error(`unsupported caType ${caType}`);
  }
}

function caTypeToKind(caType: string): number {
  switch (caType) {
    case "CashDividend":
    case "StockDividend":
      return KIND_YIELD;
    case "ForwardSplit":
    case "ReverseSplit":
      return KIND_SUPPLY;
    case "SpinOff":
      return KIND_OTHER;
    default:
      throw new Error(`unsupported caType for kind ${caType}`);
  }
}

export function registryPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), mint.toBuffer()],
    REGISTRY_PROGRAM
  )[0];
}

export function encodeSyncPayload(
  mint: PublicKey,
  events: {
    eventId: string;
    caType: number;
    kind: number;
    effectiveTs: number;
    multiplierOld: bigint;
    multiplierNew: bigint;
  }[]
): Buffer {
  const chunks: Buffer[] = [mint.toBuffer()];
  const count = Buffer.alloc(4);
  count.writeUInt32LE(events.length);
  chunks.push(count);

  for (const event of events) {
    chunks.push(Buffer.from(hashEventId(event.eventId)));
    chunks.push(Buffer.from([event.caType]));
    chunks.push(Buffer.from([event.kind]));
    const effectiveTs = Buffer.alloc(8);
    effectiveTs.writeBigInt64LE(BigInt(event.effectiveTs));
    chunks.push(effectiveTs);
    const multiplierOld = Buffer.alloc(8);
    multiplierOld.writeBigUInt64LE(event.multiplierOld);
    chunks.push(multiplierOld);
    const multiplierNew = Buffer.alloc(8);
    multiplierNew.writeBigUInt64LE(event.multiplierNew);
    chunks.push(multiplierNew);
  }

  return Buffer.concat(chunks);
}

function toSyncEvents(actions: CorporateAction[]) {
  const out: {
    eventId: string;
    caType: number;
    kind: number;
    effectiveTs: number;
    multiplierOld: bigint;
    multiplierNew: bigint;
  }[] = [];

  for (const action of actions) {
    if (!action.multiplierOld || !action.multiplierNew) continue;
    try {
      out.push({
        eventId: action.eventId,
        caType: caTypeFromString(action.caType),
        kind: caTypeToKind(action.caType),
        effectiveTs: Math.floor(
          new Date(action.effectiveTimeUtc).getTime() / 1000
        ),
        multiplierOld: parseMultiplier(action.multiplierOld),
        multiplierNew: parseMultiplier(action.multiplierNew),
      });
    } catch {
      // skip unsupported types
    }
  }

  out.sort((a, b) => a.effectiveTs - b.effectiveTs);
  return out;
}

export type SeedProgress = (msg: string) => void;

/**
 * Ensure ca_registry exists for mint and is backfilled from xStocks CA history.
 * Uses wallet as registry authority (local Surfpool / desk path).
 */
export async function ensureRegistrySeeded(args: {
  connection: Connection;
  wallet: Wallet;
  symbol: string;
  mint: string;
  onProgress?: SeedProgress;
}): Promise<{ registry: PublicKey; yieldNonce: number; eventCount: number }> {
  const { connection, wallet, symbol, mint, onProgress } = args;
  const mintPk = new PublicKey(mint);
  const registry = registryPda(mintPk);

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(registryIdl as any, provider);

  let info = await connection.getAccountInfo(registry);
  if (!info) {
    onProgress?.(`Initializing ca_registry for ${symbol}…`);
    // Touch mint so Surfpool pulls mainnet account if missing
    await connection.getAccountInfo(mintPk);
    await program.methods
      .initializeRegistry(symbol, MOCK_FORWARDER)
      .accountsPartial({
        authority: wallet.publicKey,
        mint: mintPk,
        registry,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    info = await connection.getAccountInfo(registry);
  }

  onProgress?.(`Fetching ${symbol} corporate-action history…`);
  const history = await fetchCaHistory(symbol);
  const events = toSyncEvents(history);
  if (events.length === 0) {
    onProgress?.(
      `No complete CA multipliers for ${symbol} — registry ready at genesis.`
    );
    return { registry, yieldNonce: 0, eventCount: 0 };
  }

  // sync in chunks of 8 to stay under tx size
  const chunkSize = 8;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    onProgress?.(
      `Syncing CA events ${i + 1}–${Math.min(i + chunkSize, events.length)} / ${events.length}…`
    );
    const payload = encodeSyncPayload(mintPk, chunk);
    await program.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: wallet.publicKey,
        registry,
      })
      .rpc();
  }

  const after = await connection.getAccountInfo(registry);
  if (!after) {
    throw new Error(`Registry account missing after seed for ${symbol}`);
  }
  // Layout: disc(8)+mint(32)+auth(32)+fwd(32)+sym(8)+len(1)+bump(1)+cumY(8)+cumS(8)+yieldNonce(4)+eventCount(4)
  const yieldNonce = after.data.readUInt32LE(130);
  const eventCount = after.data.readUInt32LE(134);
  return {
    registry,
    yieldNonce,
    eventCount,
  };
}
