import { Program, AnchorProvider } from "@anchor-lang/core";
import BN from "bn.js";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "./divstrip.json";
import { DIVSTRIP_PROGRAM_ID } from "./markets";
import { registryPda } from "./seed-registry";
import {
  buildDbcSwapTransaction,
  type DbcSwapQuote,
} from "./dbc-pool-desk";
import type { StripWindow } from "./strip-tx";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

function marketPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strip"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

function seriesPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("series"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function ptMintPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pt-mint"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function vaultAuthority(market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

function ytMintPda(market: PublicKey, start: number, target: number) {
  const startBuf = Buffer.alloc(4);
  startBuf.writeUInt32LE(start);
  const targetBuf = Buffer.alloc(4);
  targetBuf.writeUInt32LE(target);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yt-mint"), market.toBuffer(), startBuf, targetBuf],
    PROGRAM_ID
  )[0];
}

function lcYtMintPda(series: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lc-yt-mint"), series.toBuffer()],
    PROGRAM_ID
  )[0];
}

/** On-chain PDA seed is still `curve-bridge` (program account: CurveYtBridge). */
function curveYtVaultPda(series: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve-bridge"), series.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function curveLaunchPda(series: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve-launch"), series.toBuffer()],
    PROGRAM_ID
  )[0];
}

function programFor(connection: Connection) {
  const provider = new AnchorProvider(
    connection,
    {} as never,
    AnchorProvider.defaultOptions()
  );
  return new Program(idl as never, provider);
}

export type CurveYtVaultState = {
  /** Vault PDA exists and is wired to this pool's curve-YT mint. */
  initialized: boolean;
  /** Vault account exists on-chain (may be wrong curve-YT mint). */
  vaultExists: boolean;
  /** False when vault exists but was init'd for a different curve-YT mint. */
  curveMintMatch: boolean;
  onChainCurveYtMint: PublicKey | null;
  vaultCurveYtRaw: bigint;
  vaultStripYtRaw: bigint;
  walletLcYtRaw: bigint;
  lcYtMint: PublicKey | null;
  vaultPda: PublicKey;
};

export function curveYtVaultAccounts(
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey
) {
  const market = marketPda(window.underlyingMint);
  const series = seriesPda(market, window.startNonce, window.targetNonce);
  const vault = curveYtVaultPda(series);
  const ytMint = ytMintPda(market, window.startNonce, window.targetNonce);
  const lcYtMint = lcYtMintPda(series);
  const userStripYt = getAssociatedTokenAddressSync(ytMint, wallet);
  const userCurveYt = getAssociatedTokenAddressSync(curveYtMint, wallet);
  const userLcYt = getAssociatedTokenAddressSync(lcYtMint, wallet);
  const vaultStripYt = getAssociatedTokenAddressSync(ytMint, vault, true);
  const vaultCurveYt = getAssociatedTokenAddressSync(curveYtMint, vault, true);

  return {
    market,
    series,
    launch: curveLaunchPda(series),
    vault,
    ytMint,
    lcYtMint,
    curveYtMint,
    userStripYt,
    userCurveYt,
    userLcYt,
    vaultStripYt,
    vaultCurveYt,
  };
}

export type CurveLaunchState = {
  registered: boolean;
  launchPda: PublicKey;
  curveYtMint: PublicKey | null;
  pool: PublicKey | null;
  launchFairPpm: number | null;
  initialMcapUsd: number | null;
  migrationMcapUsd: number | null;
};

export async function fetchStripMarketAuthority(
  connection: Connection,
  underlyingMint: PublicKey
): Promise<PublicKey | null> {
  const market = marketPda(underlyingMint);
  const info = await connection.getAccountInfo(market);
  if (!info) return null;
  const program = programFor(connection);
  try {
    const decoded = await program.account.stripMarket.fetch(market);
    return decoded.authority as PublicKey;
  } catch {
    return null;
  }
}

export async function fetchCurveLaunchState(
  connection: Connection,
  window: StripWindow
): Promise<CurveLaunchState> {
  const market = marketPda(window.underlyingMint);
  const series = seriesPda(market, window.startNonce, window.targetNonce);
  const launch = curveLaunchPda(series);
  const info = await connection.getAccountInfo(launch);
  if (!info) {
    return {
      registered: false,
      launchPda: launch,
      curveYtMint: null,
      pool: null,
      launchFairPpm: null,
      initialMcapUsd: null,
      migrationMcapUsd: null,
    };
  }
  const program = programFor(connection);
  try {
    const decoded = await program.account.curveWindowLaunch.fetch(launch);
    return {
      registered: true,
      launchPda: launch,
      curveYtMint: decoded.curveYtMint as PublicKey,
      pool: decoded.pool as PublicKey,
      launchFairPpm: Number(decoded.launchFairPpm),
      initialMcapUsd: Number(decoded.initialMcapUsd),
      migrationMcapUsd: Number(decoded.migrationMcapUsd),
    };
  } catch {
    return {
      registered: false,
      launchPda: launch,
      curveYtMint: null,
      pool: null,
      launchFairPpm: null,
      initialMcapUsd: null,
      migrationMcapUsd: null,
    };
  }
}

export async function buildRequestCurveLaunchTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow
): Promise<Transaction> {
  const program = programFor(connection);
  const market = marketPda(window.underlyingMint);
  const registry = registryPda(window.underlyingMint);
  return program.methods
    .requestCurveLaunch(window.startNonce, window.targetNonce)
    .accountsPartial({
      payer: wallet,
      market,
      registry,
    })
    .transaction();
}

export async function buildRegisterCurveLaunchTransaction(
  connection: Connection,
  registrar: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  pool: PublicKey,
  launchFairPpm: number,
  initialMcapUsd: number,
  migrationMcapUsd: number
): Promise<Transaction> {
  const program = programFor(connection);
  const market = marketPda(window.underlyingMint);
  const series = seriesPda(market, window.startNonce, window.targetNonce);
  const launch = curveLaunchPda(series);
  return program.methods
    .registerCurveLaunch(
      curveYtMint,
      pool,
      launchFairPpm,
      new BN(initialMcapUsd),
      new BN(migrationMcapUsd)
    )
    .accountsPartial({
      registrar,
      market,
      series,
      launch,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
}

export async function fetchCurveYtVaultState(
  connection: Connection,
  window: StripWindow,
  curveYtMint: PublicKey
): Promise<CurveYtVaultState> {
  const wallet = PublicKey.default;
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  const info = await connection.getAccountInfo(a.vault);
  if (!info) {
    return {
      initialized: false,
      vaultExists: false,
      curveMintMatch: false,
      onChainCurveYtMint: null,
      vaultCurveYtRaw: 0n,
      vaultStripYtRaw: 0n,
      walletLcYtRaw: 0n,
      lcYtMint: null,
      vaultPda: a.vault,
    };
  }

  const program = programFor(connection);
  let onChainCurveYtMint: PublicKey | null = null;
  try {
    const decoded = await program.account.curveYtBridge.fetch(a.vault);
    onChainCurveYtMint = decoded.curveYtMint as PublicKey;
  } catch {
    onChainCurveYtMint = null;
  }
  const curveMintMatch =
    onChainCurveYtMint != null &&
    onChainCurveYtMint.equals(curveYtMint);

  let vaultCurveYtRaw = 0n;
  let vaultStripYtRaw = 0n;
  try {
    const bal = await connection.getTokenAccountBalance(a.vaultCurveYt);
    vaultCurveYtRaw = BigInt(bal.value.amount);
  } catch {
    vaultCurveYtRaw = 0n;
  }
  try {
    const bal = await connection.getTokenAccountBalance(a.vaultStripYt);
    vaultStripYtRaw = BigInt(bal.value.amount);
  } catch {
    vaultStripYtRaw = 0n;
  }

  return {
    initialized: curveMintMatch,
    vaultExists: true,
    curveMintMatch,
    onChainCurveYtMint,
    vaultCurveYtRaw,
    vaultStripYtRaw,
    walletLcYtRaw: 0n,
    lcYtMint: a.lcYtMint,
    vaultPda: a.vault,
  };
}

export async function fetchCurveYtVaultStateForWallet(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey
): Promise<CurveYtVaultState> {
  const base = await fetchCurveYtVaultState(connection, window, curveYtMint);
  if (!base.initialized) return base;
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  let walletLcYtRaw = 0n;
  try {
    const bal = await connection.getTokenAccountBalance(a.userLcYt);
    walletLcYtRaw = BigInt(bal.value.amount);
  } catch {
    walletLcYtRaw = 0n;
  }
  return { ...base, walletLcYtRaw };
}

function sharePreInstructions(
  wallet: PublicKey,
  a: ReturnType<typeof curveYtVaultAccounts>
) {
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      a.userCurveYt,
      wallet,
      a.curveYtMint
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      a.userLcYt,
      wallet,
      a.lcYtMint
    ),
  ];
}

export async function buildInitCurveVaultTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey
): Promise<Transaction> {
  const program = programFor(connection);
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  return program.methods
    .initCurveBridge(curveYtMint)
    .accountsPartial({
      payer: wallet,
      market: a.market,
      series: a.series,
      launch: a.launch,
      bridge: a.vault,
      bridgeAuthority: a.vault,
      vaultStripYt: a.vaultStripYt,
      vaultCurveYt: a.vaultCurveYt,
      lcYtMint: a.lcYtMint,
      stripYtMint: a.ytMint,
      curveYtMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
}

/** Create strip market + series PDAs if missing (required before register_curve_launch). */
export async function buildEnsureStripWindowTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  marketSymbol: string
): Promise<Transaction> {
  const program = programFor(connection);
  const market = marketPda(window.underlyingMint);
  const series = seriesPda(market, window.startNonce, window.targetNonce);
  const ptMint = ptMintPda(market, window.startNonce, window.targetNonce);
  const ytMint = ytMintPda(market, window.startNonce, window.targetNonce);
  const registry = registryPda(window.underlyingMint);
  const vaultAuth = vaultAuthority(market);
  const lockNonces = window.targetNonce - window.startNonce;

  const [marketInfo, seriesInfo, registryInfo] =
    await connection.getMultipleAccountsInfo([market, series, registry]);

  if (!registryInfo) {
    throw new Error(
      "ca_registry missing for this xStock — seed registry before registering the pool."
    );
  }

  const tx = new Transaction();

  if (!marketInfo) {
    const initMarket = await program.methods
      .initializeStrip(marketSymbol, lockNonces)
      .accountsPartial({
        authority: wallet,
        underlyingMint: window.underlyingMint,
        registry,
        market,
        vaultAuthority: vaultAuth,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.add(initMarket);
  }

  if (!seriesInfo) {
    const createSeries = await program.methods
      .createSeries(window.startNonce, window.targetNonce)
      .accountsPartial({
        payer: wallet,
        market,
        registry,
        series,
        ptMint,
        ytMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.add(createSeries);
  }

  return tx;
}

/** Create strip market + series if needed, then init curve-YT vault (no split required). */
export async function buildPrepareAndInitVaultTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  marketSymbol: string
): Promise<Transaction> {
  const program = programFor(connection);
  const market = marketPda(window.underlyingMint);
  const series = seriesPda(market, window.startNonce, window.targetNonce);
  const vault = curveYtVaultPda(series);
  const ptMint = ptMintPda(market, window.startNonce, window.targetNonce);
  const ytMint = ytMintPda(market, window.startNonce, window.targetNonce);
  const registry = registryPda(window.underlyingMint);
  const vaultAuth = vaultAuthority(market);
  const lockNonces = window.targetNonce - window.startNonce;

  const [marketInfo, seriesInfo, vaultInfo, registryInfo] =
    await connection.getMultipleAccountsInfo([
      market,
      series,
      vault,
      registry,
    ]);

  if (!registryInfo) {
    throw new Error(
      "ca_registry missing for this xStock — seed registry before initializing the vault."
    );
  }

  const tx = new Transaction();

  if (!marketInfo) {
    const initMarket = await program.methods
      .initializeStrip(marketSymbol, lockNonces)
      .accountsPartial({
        authority: wallet,
        underlyingMint: window.underlyingMint,
        registry,
        market,
        vaultAuthority: vaultAuth,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.add(initMarket);
  }

  if (!seriesInfo) {
    const createSeries = await program.methods
      .createSeries(window.startNonce, window.targetNonce)
      .accountsPartial({
        payer: wallet,
        market,
        registry,
        series,
        ptMint,
        ytMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.add(createSeries);
  }

  if (vaultInfo) {
    const program = programFor(connection);
    const decoded = await program.account.curveYtBridge.fetch(vault);
    if (!(decoded.curveYtMint as PublicKey).equals(curveYtMint)) {
      throw new Error(
        "Curve-YT vault exists for this window but is linked to a different curve-YT mint. " +
          "Reset Surfpool (:memory: DB) or pick the window that matches your pool launch."
      );
    }
  } else {
    const initTx = await buildInitCurveVaultTransaction(
      connection,
      wallet,
      window,
      curveYtMint
    );
    tx.add(...initTx.instructions);
  }

  if (tx.instructions.length === 0) {
    throw new Error("Curve-YT vault is already initialized for this pool.");
  }

  return tx;
}

export async function buildDepositCurveYtForSharesTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  curveAmountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  return program.methods
    .depositCurveYtForShares(new BN(curveAmountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      series: a.series,
      bridge: a.vault,
      bridgeAuthority: a.vault,
      curveYtMint,
      lcYtMint: a.lcYtMint,
      userCurveYt: a.userCurveYt,
      userLcYt: a.userLcYt,
      vaultCurveYt: a.vaultCurveYt,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(sharePreInstructions(wallet, a))
    .transaction();
}

export async function buildRedeemSharesForCurveTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  curveAmountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  return program.methods
    .redeemSharesForCurveYt(new BN(curveAmountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      series: a.series,
      bridge: a.vault,
      bridgeAuthority: a.vault,
      curveYtMint,
      lcYtMint: a.lcYtMint,
      userCurveYt: a.userCurveYt,
      userLcYt: a.userLcYt,
      vaultCurveYt: a.vaultCurveYt,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(sharePreInstructions(wallet, a))
    .transaction();
}

/** Vault proxy buy: Meteora USDC→curve-YT, then deposit to vault and mint lcYT. */
export async function buildVaultBuyTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  pool: PublicKey | string,
  buyQuote: DbcSwapQuote
): Promise<Transaction> {
  const swapTx = await buildDbcSwapTransaction(
    connection,
    wallet,
    pool,
    buyQuote
  );
  const curveOut = BigInt(buyQuote.minimumAmountOut.toString());
  const depositTx = await buildDepositCurveYtForSharesTransaction(
    connection,
    wallet,
    window,
    curveYtMint,
    curveOut
  );
  const tx = new Transaction();
  tx.add(...swapTx.instructions);
  tx.add(...depositTx.instructions);
  return tx;
}

/** Vault proxy sell: redeem lcYT→curve-YT, then Meteora sell for USDC. */
export async function buildVaultSellTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  pool: PublicKey | string,
  curveAmountRaw: bigint,
  sellQuote: DbcSwapQuote
): Promise<Transaction> {
  const redeemTx = await buildRedeemSharesForCurveTransaction(
    connection,
    wallet,
    window,
    curveYtMint,
    curveAmountRaw
  );
  const sellTx = await buildDbcSwapTransaction(
    connection,
    wallet,
    pool,
    sellQuote
  );
  const tx = new Transaction();
  tx.add(...redeemTx.instructions);
  tx.add(...sellTx.instructions);
  return tx;
}

export async function buildSwapStripForCurveTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  stripAmountRaw: bigint,
  curveAmountRaw: bigint,
  minCurveOutRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = curveYtVaultAccounts(wallet, window, curveYtMint);
  return program.methods
    .swapStripYtForCurveYt(
      new BN(stripAmountRaw.toString()),
      new BN(curveAmountRaw.toString()),
      new BN(minCurveOutRaw.toString())
    )
    .accountsPartial({
      user: wallet,
      market: a.market,
      series: a.series,
      bridge: a.vault,
      bridgeAuthority: a.vault,
      stripYtMint: a.ytMint,
      curveYtMint,
      userStripYt: a.userStripYt,
      userCurveYt: a.userCurveYt,
      vaultStripYt: a.vaultStripYt,
      vaultCurveYt: a.vaultCurveYt,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      createAssociatedTokenAccountIdempotentInstruction(
        wallet,
        a.userCurveYt,
        wallet,
        curveYtMint
      ),
    ])
    .transaction();
}

/** Swap strip YT for curve-YT in the vault, then sell curve-YT for USDC on Meteora. */
export async function buildStripExitTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  curveYtMint: PublicKey,
  pool: PublicKey | string,
  stripAmountRaw: bigint,
  curveAmountRaw: bigint,
  minCurveOutRaw: bigint,
  sellQuote: DbcSwapQuote
): Promise<Transaction> {
  const swapTx = await buildSwapStripForCurveTransaction(
    connection,
    wallet,
    window,
    curveYtMint,
    stripAmountRaw,
    curveAmountRaw,
    minCurveOutRaw
  );
  const sellTx = await buildDbcSwapTransaction(
    connection,
    wallet,
    pool,
    sellQuote
  );
  const tx = new Transaction();
  tx.add(...swapTx.instructions);
  tx.add(...sellTx.instructions);
  return tx;
}
