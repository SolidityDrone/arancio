import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurveWithMarketCap,
  deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

/** Native SOL wrapped mint — always available on Surfpool/mainnet forks */
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);

export type StripWindow = {
  symbol: string;
  startNonce: number;
  targetNonce: number;
  /** Fair coupon in [0, 1] from registry: 1 - Ys/Yt */
  fairCoupon: number;
};

export type LaunchYtResult = {
  config: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  initialMarketCap: number;
  migrationMarketCap: number;
  transaction: Transaction;
  /** Must co-sign createConfigAndPool */
  signers: Keypair[];
};

/**
 * Equity-strip curve: seed initial mcap from fair coupon (income notional),
 * migrate to DAMM v2 once discovery clears ~10× that level.
 */
export function buildYtStripCurve(fairCoupon: number) {
  // Market caps are in WSOL (SOL) units — Meteora DBC validates supply against these.
  const initialMarketCap = Math.max(30, 30 + Math.round(fairCoupon * 500));
  const migrationMarketCap = Math.max(600, initialMarketCap * 20);

  const configParams = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE, // WSOL
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 100,
          endingFeeBps: 30,
          numberOfPeriod: 50,
          totalDuration: 50 * 60,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 20,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      // Non-zero migration fee breaks create_config on Surfpool (InvalidTokenSupply 6020).
      migrationFee: {
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 45,
      partnerLiquidityPercentage: 55,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap,
    migrationMarketCap,
  });

  return { configParams, initialMarketCap, migrationMarketCap };
}

export async function buildLaunchYtOnDbc(args: {
  connection: Connection;
  payer: PublicKey;
  window: StripWindow;
  quoteMint?: PublicKey;
}): Promise<LaunchYtResult> {
  const quoteMint = args.quoteMint ?? WSOL_MINT;
  const { configParams, initialMarketCap, migrationMarketCap } =
    buildYtStripCurve(args.window.fairCoupon);

  const config = Keypair.generate();
  const baseMint = Keypair.generate();
  const client = DynamicBondingCurveClient.create(args.connection, "confirmed");

  const name = `${args.window.symbol} Yield ${args.window.startNonce}-${args.window.targetNonce}`;
  const symbol = `YT${args.window.symbol}${args.window.startNonce}`.slice(0, 10);
  const uri = `https://xstocks.fi/assets/${encodeURIComponent(args.window.symbol)}`;

  const transaction = await client.partner.createConfigAndPool({
    ...configParams,
    config: config.publicKey,
    feeClaimer: args.payer,
    leftoverReceiver: args.payer,
    quoteMint,
    payer: args.payer,
    preCreatePoolParam: {
      name,
      symbol,
      uri,
      poolCreator: args.payer,
      baseMint: baseMint.publicKey,
    },
  });

  const pool = deriveDbcPoolAddress(
    quoteMint,
    baseMint.publicKey,
    config.publicKey
  );

  // Ensure recent blockhash for wallet send
  const { blockhash, lastValidBlockHeight } =
    await args.connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = args.payer;

  return {
    config: config.publicKey,
    pool,
    baseMint: baseMint.publicKey,
    quoteMint,
    initialMarketCap,
    migrationMarketCap,
    transaction,
    signers: [config, baseMint],
  };
}

export async function fetchPoolProgress(
  connection: Connection,
  pool: PublicKey
): Promise<{ quoteProgress: number; isMigrated: boolean } | null> {
  try {
    const client = DynamicBondingCurveClient.create(connection, "confirmed");
    const state = await client.state.getPool(pool);
    if (!state) return null;
    const quoteProgress = await client.state.getPoolQuoteTokenCurveProgress(pool);
    return {
      quoteProgress,
      isMigrated: Boolean((state as { isMigrated?: number }).isMigrated),
    };
  } catch {
    return null;
  }
}

export async function buildMigrateToDammV2Tx(args: {
  connection: Connection;
  payer: PublicKey;
  pool: PublicKey;
  dammConfig: PublicKey;
}): Promise<{ transaction: Transaction; signers: Keypair[] } | null> {
  try {
    const client = DynamicBondingCurveClient.create(args.connection, "confirmed");
    const res = await client.migration.migrateToDammV2({
      payer: args.payer,
      pool: args.pool,
      dammConfig: args.dammConfig,
    });
    return {
      transaction: res.transaction,
      signers: [res.firstPositionNftKeypair, res.secondPositionNftKeypair],
    };
  } catch {
    return null;
  }
}

/** localStorage helpers for launched pools */
const LAUNCH_KEY = "divstrip.meteora.launches.v1";

export type StoredLaunch = {
  symbol: string;
  startNonce: number;
  targetNonce: number;
  fairCoupon: number;
  config: string;
  pool: string;
  baseMint: string;
  quoteMint: string;
  initialMarketCap: number;
  migrationMarketCap: number;
  launchedAt: number;
  launchSignature?: string;
};

export function loadLaunches(): StoredLaunch[] {
  try {
    return JSON.parse(localStorage.getItem(LAUNCH_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveLaunch(launch: StoredLaunch) {
  const all = loadLaunches().filter(
    (l) =>
      !(
        l.symbol === launch.symbol &&
        l.startNonce === launch.startNonce &&
        l.targetNonce === launch.targetNonce
      )
  );
  all.unshift(launch);
  localStorage.setItem(LAUNCH_KEY, JSON.stringify(all.slice(0, 40)));
}

export function migratorUrl(pool: string) {
  return `https://migrator.meteora.ag/?pool=${pool}`;
}

/** Meteora app pool page (DBC pre-migrate or DAMM post-migrate). */
export function meteoraAppPoolUrl(pool: string) {
  return `https://app.meteora.ag/pools/${pool}`;
}

export function jupiterSwapUrl(inputMint: string, outputMint: string) {
  return `https://jup.ag/swap/${inputMint}-${outputMint}`;
}
