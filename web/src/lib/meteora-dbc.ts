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
  buildCurveWithLiquidityWeights,
  deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { computeCurvePolicy } from "./curve-policy";
import { stripLiquidityWeights } from "./dbc-curve-shape";

/** Native SOL wrapped mint — gas only; DBC quote leg uses USDC. */
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

/** Circle USDC (mainnet / Surfpool mainnet fork). */
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

/** Default Meteora DBC / DAMM quote token. */
export const DEFAULT_QUOTE_MINT = USDC_MINT;
export const QUOTE_SYMBOL = "USDC";
export const QUOTE_DECIMALS = 6;

export const DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);

/** Meteora liquidity-weight curves need a small leftover buffer (≈0.05% supply). */
export const STRIP_DBC_LEFTOVER = 50;

export type StripLaunchContext = {
  symbol: string;
  yieldNonce: number;
  /** Fair coupon in [0, 1] for on-chain register_curve_launch. */
  fairCoupon: number;
  /** Mean historical cash dividend (USD per share) for DBC pricing. */
  avgDistributionUsd?: number;
};

/** @deprecated Use StripLaunchContext */
export type StripWindow = StripLaunchContext & {
  startNonce?: number;
  targetNonce?: number;
};

export type LaunchYtResult = {
  config: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  initialMarketCap: number;
  migrationMarketCap: number;
  /** Meteora createConfig — must land before createPoolTx. */
  createConfigTx: Transaction;
  /** Meteora createPool — kept separate (combined tx exceeds 1232-byte limit). */
  createPoolTx: Transaction;
  /** Signs createConfigTx only. */
  configKeypair: Keypair;
  /** Signs createPoolTx only (new curve-YT mint). */
  baseMintKeypair: Keypair;
};

export async function refreshTransactionBlockhash(
  connection: Connection,
  transaction: Transaction,
  feePayer: PublicKey
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = feePayer;
  return transaction;
}

/** DAMM v2 config for MigrationFeeOption.FixedBps100 (matches pool migration fee). */
export const DEFAULT_DAMM_V2_CONFIG = new PublicKey(
  "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp"
);

/**
 * Equity-strip curve: ~60%→80% of fair mcap, concave (fast early, flat late).
 * Uses Meteora liquidity weights — not a linear mcap ramp.
 */
export function buildYtStripCurve(
  fairCoupon: number,
  avgDistributionUsd?: number,
  startingPriceRatio?: number
) {
  const policy = computeCurvePolicy({
    fairCoupon,
    avgDistributionUsd: avgDistributionUsd ?? 1,
    startingPriceRatio,
  });
  const initialMarketCap = policy.initialMarketCapUsd;
  const migrationMarketCap = policy.migrationMarketCapUsd;
  const liquidityWeights = stripLiquidityWeights();

  const configParams = buildCurveWithLiquidityWeights({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.SIX,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: policy.totalTokenSupply,
      leftover: STRIP_DBC_LEFTOVER,
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
    liquidityWeights,
  });

  return {
    configParams,
    initialMarketCap,
    migrationMarketCap,
    policy,
    liquidityWeights,
  };
}

export async function buildLaunchYtOnDbc(args: {
  connection: Connection;
  payer: PublicKey;
  launch: StripLaunchContext;
  quoteMint?: PublicKey;
}): Promise<LaunchYtResult> {
  const quoteMint = args.quoteMint ?? DEFAULT_QUOTE_MINT;
  const ctx = args.launch;
  const { configParams, initialMarketCap, migrationMarketCap } =
    buildYtStripCurve(ctx.fairCoupon, ctx.avgDistributionUsd);

  const config = Keypair.generate();
  const baseMint = Keypair.generate();
  const client = DynamicBondingCurveClient.create(args.connection, "confirmed");

  const name = `${ctx.symbol} Yield n${ctx.yieldNonce}`;
  const symbol = `YT${ctx.symbol}${ctx.yieldNonce}`.slice(0, 10);
  const uri = `https://xstocks.fi/assets/${encodeURIComponent(ctx.symbol)}`;

  const { createConfigTx, createPoolWithFirstBuyTx: createPoolTx } =
    await client.partner.createConfigAndPoolWithFirstBuy({
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

  await refreshTransactionBlockhash(args.connection, createConfigTx, args.payer);
  await refreshTransactionBlockhash(args.connection, createPoolTx, args.payer);

  return {
    config: config.publicKey,
    pool,
    baseMint: baseMint.publicKey,
    quoteMint,
    initialMarketCap,
    migrationMarketCap,
    createConfigTx,
    createPoolTx,
    configKeypair: config,
    baseMintKeypair: baseMint,
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

/** Session-only launched pools — not persisted (Surfpool resets would go stale). */

export type StoredLaunch = {
  symbol: string;
  yieldNonce: number;
  /** @deprecated Legacy window launches */
  startNonce?: number;
  targetNonce?: number;
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

let launches: StoredLaunch[] = [];

export function launchYieldNonce(l: StoredLaunch): number {
  return l.yieldNonce ?? l.startNonce ?? 0;
}

export function loadLaunches(): StoredLaunch[] {
  return launches.slice();
}

export function saveLaunch(launch: StoredLaunch) {
  const nonce = launchYieldNonce(launch);
  const normalized = { ...launch, yieldNonce: nonce };
  launches = [
    normalized,
    ...launches.filter(
      (l) => !(l.symbol === normalized.symbol && launchYieldNonce(l) === nonce)
    ),
  ].slice(0, 40);
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
