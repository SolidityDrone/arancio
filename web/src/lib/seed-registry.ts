import { sha1 } from "@noble/hashes/sha1";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@anchor-lang/core";
import registryIdl from "./ca_registry.json";
import { MULTIPLIER_SCALE } from "./markets";
import { MOCK_FORWARDER, registryPda } from "./registry-pda";
import { fetchCaHistory, type CorporateAction } from "./xstocks-api";

export { MOCK_FORWARDER, REGISTRY_MISSING_HINT, registryPda } from "./registry-pda";

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

function u32leBytes(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, true);
  return buf;
}

function i64leBytes(n: number | bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(n), true);
  return buf;
}

function u64leBytes(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, n, true);
  return buf;
}

function concatBytes(parts: Uint8Array[]): Buffer {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return Buffer.from(out);
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
  const chunks: Uint8Array[] = [mint.toBuffer(), u32leBytes(events.length)];

  for (const event of events) {
    chunks.push(
      hashEventId(event.eventId),
      Uint8Array.of(event.caType),
      Uint8Array.of(event.kind),
      i64leBytes(event.effectiveTs),
      u64leBytes(event.multiplierOld),
      u64leBytes(event.multiplierNew)
    );
  }

  return concatBytes(chunks);
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

function readRegistryTip(data: Buffer): {
  yieldNonce: number;
  eventCount: number;
} {
  return {
    yieldNonce: data.readUInt32LE(130),
    eventCount: data.readUInt32LE(134),
  };
}

/**
 * Init + backfill ca_registry PDA for one xStock mint (deploy key / CRE authority).
 * Skips when the registry account already exists.
 */
export async function seedRegistryWithAuthority(args: {
  connection: Connection;
  authority: Keypair;
  symbol: string;
  mint: string;
  onProgress?: SeedProgress;
  /** When true, only initialize — do not fetch xStocks CA history. */
  skipSync?: boolean;
}): Promise<{ registry: PublicKey; yieldNonce: number; eventCount: number }> {
  const { connection, authority, symbol, mint, onProgress, skipSync } = args;
  const mintPk = new PublicKey(mint);
  const registry = registryPda(mintPk);
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(registryIdl as any, provider);

  let info = await connection.getAccountInfo(registry);
  if (info) {
    const tip = readRegistryTip(info.data);
    onProgress?.(
      `${symbol}: registry exists (n${tip.yieldNonce}, ${tip.eventCount} events) — skip`
    );
    return { registry, ...tip };
  }

  onProgress?.(`Initializing ca_registry for ${symbol}…`);
  await connection.getAccountInfo(mintPk);
  await program.methods
    .initializeRegistry(symbol, MOCK_FORWARDER)
    .accountsPartial({
      authority: authority.publicKey,
      mint: mintPk,
      registry,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  info = await connection.getAccountInfo(registry);

  if (skipSync) {
    return { registry, yieldNonce: 0, eventCount: 0 };
  }

  onProgress?.(`Fetching ${symbol} corporate-action history…`);
  const history = await fetchCaHistory(symbol);
  const events = toSyncEvents(history);
  if (events.length === 0) {
    onProgress?.(
      `${symbol}: no complete CA multipliers — registry at genesis.`
    );
    return { registry, yieldNonce: 0, eventCount: 0 };
  }

  const chunkSize = 8;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    onProgress?.(
      `${symbol}: syncing CA ${i + 1}–${Math.min(i + chunkSize, events.length)} / ${events.length}…`
    );
    const payload = encodeSyncPayload(mintPk, chunk);
    await program.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: authority.publicKey,
        registry,
      })
      .rpc();
  }

  const after = await connection.getAccountInfo(registry);
  if (!after) {
    throw new Error(`Registry account missing after seed for ${symbol}`);
  }
  return { registry, ...readRegistryTip(after.data) };
}
