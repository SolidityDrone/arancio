export const DIVSTRIP_PROGRAM_ID =
  "A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz";
export const CA_REGISTRY_PROGRAM_ID =
  "2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z";

export const DEFAULT_RPC =
  import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8899";

export const MULTIPLIER_SCALE = 1_000_000_000_000n;

/** PT/YT mint decimals on divstrip (underlying xStock is typically 8). */
export const SHARE_DECIMALS = 6;

export type MarketSector =
  | "Mag 7"
  | "Index"
  | "Dividend"
  | "Financials"
  | "Energy"
  | "Healthcare"
  | "Consumer";

export type MarketConfig = {
  symbol: string;
  name: string;
  mint: string;
  sector: MarketSector;
  lockNonces: number;
  /** Demo stats when chain data is unavailable */
  demo: {
    yieldNonce: number;
    cumY: string;
    eventCount: number;
    nextDivHint: string;
  };
};

/** Local logos mirrored from xstocks-metadata.backed.fi */
export function marketLogo(symbol: string): string {
  return `/logos/${symbol}.png`;
}

/** Curated mega-cap xStocks — mints from api.xstocks.fi (Solana deployments) */
export const MARKETS: MarketConfig[] = [
  {
    symbol: "AAPLx",
    name: "Apple",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 3, cumY: "1.011200", eventCount: 3, nextDivHint: "Quarterly dividend" },
  },
  {
    symbol: "MSFTx",
    name: "Microsoft",
    mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.014800", eventCount: 4, nextDivHint: "Growth + buybacks" },
  },
  {
    symbol: "GOOGLx",
    name: "Alphabet",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 2, cumY: "1.006400", eventCount: 2, nextDivHint: "Thin yield leg" },
  },
  {
    symbol: "AMZNx",
    name: "Amazon",
    mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 0, cumY: "1.000000", eventCount: 0, nextDivHint: "PT-heavy — no div history" },
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 1, cumY: "1.002100", eventCount: 1, nextDivHint: "Emerging dividend" },
  },
  {
    symbol: "METAx",
    name: "Meta",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 1, cumY: "1.003500", eventCount: 1, nextDivHint: "New dividend policy" },
  },
  {
    symbol: "TSLAx",
    name: "Tesla",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    sector: "Mag 7",
    lockNonces: 2,
    demo: { yieldNonce: 0, cumY: "1.000000", eventCount: 0, nextDivHint: "Pure beta — no yield" },
  },
  {
    symbol: "SPYx",
    name: "S&P 500",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    sector: "Index",
    lockNonces: 2,
    demo: { yieldNonce: 6, cumY: "1.028400", eventCount: 6, nextDivHint: "Broad index strip" },
  },
  {
    symbol: "QQQx",
    name: "Nasdaq 100",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    sector: "Index",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.016200", eventCount: 4, nextDivHint: "Growth index basket" },
  },
  {
    symbol: "VTIx",
    name: "Vanguard Total Market",
    mint: "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9",
    sector: "Index",
    lockNonces: 2,
    demo: { yieldNonce: 5, cumY: "1.022000", eventCount: 5, nextDivHint: "Total market exposure" },
  },
  {
    symbol: "KOx",
    name: "Coca-Cola",
    mint: "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
    sector: "Dividend",
    lockNonces: 2,
    demo: { yieldNonce: 5, cumY: "1.022560", eventCount: 5, nextDivHint: "Classic dividend aristocrat" },
  },
  {
    symbol: "PEPx",
    name: "PepsiCo",
    mint: "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF",
    sector: "Dividend",
    lockNonces: 2,
    demo: { yieldNonce: 5, cumY: "1.021800", eventCount: 5, nextDivHint: "Steady consumer yield" },
  },
  {
    symbol: "WMTx",
    name: "Walmart",
    mint: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci",
    sector: "Dividend",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.018500", eventCount: 4, nextDivHint: "Defensive dividend" },
  },
  {
    symbol: "JPMx",
    name: "JPMorgan Chase",
    mint: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C",
    sector: "Financials",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.019200", eventCount: 4, nextDivHint: "Bank dividend cycle" },
  },
  {
    symbol: "BACx",
    name: "Bank of America",
    mint: "XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP",
    sector: "Financials",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.017600", eventCount: 4, nextDivHint: "Large-cap bank yield" },
  },
  {
    symbol: "XOMx",
    name: "Exxon Mobil",
    mint: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh",
    sector: "Energy",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.024100", eventCount: 4, nextDivHint: "Energy dividend strip" },
  },
  {
    symbol: "CVXx",
    name: "Chevron",
    mint: "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts",
    sector: "Energy",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.023400", eventCount: 4, nextDivHint: "Integrated oil major" },
  },
  {
    symbol: "JNJx",
    name: "Johnson & Johnson",
    mint: "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn",
    sector: "Healthcare",
    lockNonces: 2,
    demo: { yieldNonce: 5, cumY: "1.025600", eventCount: 5, nextDivHint: "Healthcare dividend king" },
  },
  {
    symbol: "UNHx",
    name: "UnitedHealth",
    mint: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe",
    sector: "Healthcare",
    lockNonces: 2,
    demo: { yieldNonce: 3, cumY: "1.012800", eventCount: 3, nextDivHint: "Managed care yield" },
  },
  {
    symbol: "LLYx",
    name: "Eli Lilly",
    mint: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH",
    sector: "Healthcare",
    lockNonces: 2,
    demo: { yieldNonce: 2, cumY: "1.008400", eventCount: 2, nextDivHint: "Pharma growth + div" },
  },
  {
    symbol: "ABBVx",
    name: "AbbVie",
    mint: "XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie",
    sector: "Healthcare",
    lockNonces: 2,
    demo: { yieldNonce: 4, cumY: "1.020200", eventCount: 4, nextDivHint: "High-yield pharma" },
  },
  {
    symbol: "NFLXx",
    name: "Netflix",
    mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL",
    sector: "Consumer",
    lockNonces: 2,
    demo: { yieldNonce: 0, cumY: "1.000000", eventCount: 0, nextDivHint: "Growth — no dividend" },
  },
  {
    symbol: "DISx",
    name: "Walt Disney",
    mint: "Xsg93jDV656ULQ5u9yT2x5DS9b4xGD8aDCtfESSW6Bb",
    sector: "Consumer",
    lockNonces: 2,
    demo: { yieldNonce: 2, cumY: "1.007200", eventCount: 2, nextDivHint: "Media dividend restart" },
  },
  {
    symbol: "AVGOx",
    name: "Broadcom",
    mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo",
    sector: "Consumer",
    lockNonces: 2,
    demo: { yieldNonce: 3, cumY: "1.015600", eventCount: 3, nextDivHint: "Semis + dividend" },
  },
];

export const SECTORS: MarketSector[] = [
  "Mag 7",
  "Index",
  "Dividend",
  "Financials",
  "Energy",
  "Healthcare",
  "Consumer",
];

export function couponFromCum(cumStart: bigint, cumTarget: bigint): number {
  if (cumTarget === 0n) return 0;
  const ratio = Number(cumStart) / Number(cumTarget);
  return Math.max(0, 1 - ratio);
}
