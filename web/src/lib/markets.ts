export const DIVSTRIP_PROGRAM_ID =
  "A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz";
export const CA_REGISTRY_PROGRAM_ID =
  "2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z";

export const DEFAULT_RPC =
  import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8899";

export const MULTIPLIER_SCALE = 1_000_000_000_000n;

export type MarketConfig = {
  symbol: string;
  name: string;
  mint: string;
  lockNonces: number;
  /** Demo stats when chain data is unavailable */
  demo: {
    yieldNonce: number;
    cumY: string;
    eventCount: number;
    nextDivHint: string;
  };
};

/** Curated xStocks for the Stocklana demo desk */
export const MARKETS: MarketConfig[] = [
  {
    symbol: "KOx",
    name: "Coca-Cola xStock",
    mint: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
    lockNonces: 2,
    demo: {
      yieldNonce: 5,
      cumY: "1.022560",
      eventCount: 5,
      nextDivHint: "Cash dividend cadence ~ quarterly",
    },
  },
  {
    symbol: "AAPLx",
    name: "Apple xStock",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzYz",
    lockNonces: 2,
    demo: {
      yieldNonce: 3,
      cumY: "1.011200",
      eventCount: 3,
      nextDivHint: "Lower yield, strong capital leg",
    },
  },
  {
    symbol: "TSLAx",
    name: "Tesla xStock",
    mint: "XsDoVfqeBukxuZHWhAotTUzZpZXFbGxzi2XDQnBJEaD",
    lockNonces: 2,
    demo: {
      yieldNonce: 0,
      cumY: "1.000000",
      eventCount: 0,
      nextDivHint: "Sparse yield history — PT-heavy",
    },
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA xStock",
    mint: "Xsf9mBktVB9MTZ7KtctQfXegKWH2PkJb3P9o1v9u1qX",
    lockNonces: 2,
    demo: {
      yieldNonce: 1,
      cumY: "1.002100",
      eventCount: 1,
      nextDivHint: "Growth name — YT thin, PT liquid thesis",
    },
  },
];

export function couponFromCum(cumStart: bigint, cumTarget: bigint): number {
  if (cumTarget === 0n) return 0;
  const scale = Number(MULTIPLIER_SCALE);
  const ratio = Number(cumStart) / Number(cumTarget);
  return Math.max(0, 1 - ratio);
}
