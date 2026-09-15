import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

export const MULTIPLIER_SCALE = 1_000_000_000_000n;

export const KIND_YIELD = 0;
export const KIND_SUPPLY = 1;
export const KIND_OTHER = 2;

export type SyncEventInput = {
  eventId: string;
  caType: number;
  kind: number;
  effectiveTs: number;
  multiplierOld: bigint;
  multiplierNew: bigint;
};

export function hashEventId(eventId: string): Buffer {
  const digest = createHash("sha1").update(eventId).digest();
  return digest.subarray(0, 16);
}

export function parseMultiplier(value: string | null | undefined): bigint {
  if (!value) {
    return 0n;
  }
  const numeric = Number(value);
  return BigInt(Math.trunc(numeric * Number(MULTIPLIER_SCALE)));
}

export function caTypeFromString(caType: string): number {
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

export function caTypeToKind(caType: string): number {
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

export function encodeSyncPayload(
  mint: PublicKey,
  events: SyncEventInput[]
): Buffer {
  const chunks: Buffer[] = [mint.toBuffer()];

  const count = Buffer.alloc(4);
  count.writeUInt32LE(events.length);
  chunks.push(count);

  for (const event of events) {
    chunks.push(hashEventId(event.eventId));
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

export const KOX_MINT = new PublicKey(
  "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ"
);

type ApiCorporateAction = {
  eventId: string;
  caType: string;
  effectiveTimeUtc: string;
  multiplierOld?: string | null;
  multiplierNew?: string | null;
};

export async function fetchKoxHistory(): Promise<SyncEventInput[]> {
  const url =
    "https://api.xstocks.fi/api/v2/public/corporate-actions/history?symbol=KOx&network=Solana";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`KOx history fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as { nodes?: ApiCorporateAction[] };
  const nodes = body.nodes ?? [];

  const events: SyncEventInput[] = [];
  for (const node of nodes) {
    if (!node.multiplierOld || !node.multiplierNew) {
      continue;
    }
    events.push({
      eventId: node.eventId,
      caType: caTypeFromString(node.caType),
      kind: caTypeToKind(node.caType),
      effectiveTs: Math.floor(Date.parse(node.effectiveTimeUtc) / 1000),
      multiplierOld: parseMultiplier(node.multiplierOld),
      multiplierNew: parseMultiplier(node.multiplierNew),
    });
  }

  events.sort((a, b) => a.effectiveTs - b.effectiveTs);
  return events;
}

/** Fixture derived from xStocks v2 corporate-actions/history for KOx. */
export function koxHistoryFixture(): SyncEventInput[] {
  return [
    {
      eventId: "60820471-a68e-4a08-a0fe-544a5ec2267b",
      caType: 0,
      kind: KIND_YIELD,
      effectiveTs: 1741824900,
      multiplierOld: parseMultiplier("1.008956356680335626"),
      multiplierNew: parseMultiplier("1.013779482672994"),
    },
    {
      eventId: "a2ea4252-01b1-4876-a4fc-e3eb2673d31a",
      caType: 0,
      kind: KIND_YIELD,
      effectiveTs: 1749947700,
      multiplierOld: parseMultiplier("1.013779482672994"),
      multiplierNew: parseMultiplier("1.0183317967386898"),
    },
    {
      eventId: "75c0c70e-1ae4-4ccd-ace6-d8990e1e8f9e",
      caType: 0,
      kind: KIND_YIELD,
      effectiveTs: 1789432200,
      multiplierOld: parseMultiplier("1.0183317967386898"),
      multiplierNew: parseMultiplier("1.0225601246249238"),
    },
  ];
}
