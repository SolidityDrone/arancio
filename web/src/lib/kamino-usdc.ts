/**
 * Node / Next server Kamino USDC helpers (uses @kamino-finance/klend-sdk).
 * Do not import this module from Client Components — use kamino-usdc-config
 * or kamino-usdc-browser instead.
 */
import {
  AccountRole,
  address,
  createNoopSigner,
  createSolanaRpc,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  KaminoAction,
  KaminoMarket,
  PROGRAM_ID,
  VanillaObligation,
  getCurrentLedgerInstant,
} from "@kamino-finance/klend-sdk";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  KAMINO_CUSDC_MINT,
  KAMINO_MAIN_MARKET,
  KAMINO_QUOTE_SYMBOL,
  KAMINO_USDC_RESERVE,
  KLEND_PROGRAM_ID,
  isKaminoYieldBackend,
  yieldQuoteMint,
  type KaminoRedeemPreview,
  type KaminoUsdcSnapshot,
} from "./kamino-usdc-config";

export {
  KAMINO_CUSDC_MINT,
  KAMINO_MAIN_MARKET,
  KAMINO_QUOTE_SYMBOL,
  KAMINO_USDC_RESERVE,
  KLEND_PROGRAM_ID,
  isKaminoYieldBackend,
  yieldQuoteMint,
};
export type { KaminoRedeemPreview, KaminoUsdcSnapshot };

type MarketCache = {
  rpcUrl: string;
  market: KaminoMarket;
  loadedAt: number;
};

let marketCache: MarketCache | null = null;

function rpcFromConnection(connection: Connection) {
  return createSolanaRpc(connection.rpcEndpoint);
}

function kitAddr(pk: PublicKey): Address {
  return address(pk.toBase58());
}

async function loadMarket(connection: Connection): Promise<KaminoMarket> {
  const rpcUrl = connection.rpcEndpoint;
  const now = Date.now();
  if (
    marketCache &&
    marketCache.rpcUrl === rpcUrl &&
    now - marketCache.loadedAt < 30_000
  ) {
    await marketCache.market.loadReserves();
    return marketCache.market;
  }
  const rpc = rpcFromConnection(connection);
  const market = await KaminoMarket.load(
    rpc,
    kitAddr(KAMINO_MAIN_MARKET),
    400
  );
  if (!market) throw new Error("Failed to load Kamino main market");
  await market.loadReserves();
  marketCache = { rpcUrl, market, loadedAt: now };
  return market;
}

function kitIxToLegacy(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(String(ix.programAddress)),
    keys: (ix.accounts ?? []).map((a) => {
      const role = a.role as AccountRole | number;
      const isSigner =
        role === AccountRole.READONLY_SIGNER ||
        role === AccountRole.WRITABLE_SIGNER;
      const isWritable =
        role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;
      return {
        pubkey: new PublicKey(String(a.address)),
        isSigner,
        isWritable,
      };
    }),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

function actionToTransaction(action: KaminoAction): Transaction {
  const tx = new Transaction();
  for (const ix of [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.inBetweenIxs,
    ...action.lendingIxs,
    ...action.postLendingIxs,
    ...action.cleanupIxs,
  ]) {
    tx.add(kitIxToLegacy(ix));
  }
  return tx;
}

export type SerializedIx = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  dataBase64: string;
};

export function transactionToSerializedIxs(tx: Transaction): SerializedIx[] {
  return tx.instructions.map((ix) => ({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    dataBase64: Buffer.from(ix.data).toString("base64"),
  }));
}

export function serializedIxsToTransaction(
  ixs: SerializedIx[],
  feePayer: PublicKey
): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  for (const ix of ixs) {
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.keys.map((k) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.dataBase64, "base64"),
      })
    );
  }
  return tx;
}

export async function fetchKaminoUsdcSnapshot(
  connection: Connection
): Promise<KaminoUsdcSnapshot> {
  const market = await loadMarket(connection);
  const reserve = market.getReserveByAddress(kitAddr(KAMINO_USDC_RESERVE));
  if (!reserve) throw new Error("Kamino USDC reserve not found on market");
  const rpc = rpcFromConnection(connection);
  const ledger = await getCurrentLedgerInstant(rpc, "confirmed");
  const one = new Decimal(1_000_000);
  const usdcFromC = Number(reserve.cTokensToLiquidity(one, ledger).toString());
  const cFromUsdc = Number(reserve.liquidityToCTokens(one, ledger).toString());
  const supplyApy = Number(reserve.totalSupplyAPY(ledger).toString());
  return {
    reserve: KAMINO_USDC_RESERVE.toBase58(),
    cTokenMint: String(reserve.getCTokenMint()),
    liquidityMint: String(reserve.getLiquidityMint()),
    cTokensPerUsdc: cFromUsdc / 1_000_000,
    usdcPerCtoken: usdcFromC / 1_000_000,
    supplyApy,
    slot: Number(ledger.slot),
    blockTime: ledger.blockTime != null ? Number(ledger.blockTime) : null,
  };
}

/** Preview redeeming `cTokenAmount` (raw) → USDC + accrued vs 1:1 par. */
export async function previewKaminoRedeem(
  connection: Connection,
  cTokenAmount: bigint
): Promise<KaminoRedeemPreview> {
  const snap = await fetchKaminoUsdcSnapshot(connection);
  if (cTokenAmount <= 0n) {
    return {
      cTokenAmount: 0n,
      redeemableUsdc: 0n,
      accruedVsPar: 0n,
      usdcPerCtoken: snap.usdcPerCtoken,
      supplyApy: snap.supplyApy,
    };
  }
  const market = await loadMarket(connection);
  const reserve = market.getReserveByAddress(kitAddr(KAMINO_USDC_RESERVE))!;
  const rpc = rpcFromConnection(connection);
  const ledger = await getCurrentLedgerInstant(rpc, "confirmed");
  const redeemable = BigInt(
    reserve
      .cTokensToLiquidity(new Decimal(cTokenAmount.toString()), ledger)
      .toFixed(0)
  );
  const accruedVsPar =
    redeemable > cTokenAmount ? redeemable - cTokenAmount : 0n;
  return {
    cTokenAmount,
    redeemableUsdc: redeemable,
    accruedVsPar,
    usdcPerCtoken: snap.usdcPerCtoken,
    supplyApy: snap.supplyApy,
  };
}

/** USDC → mint Kamino cUSDC into the wallet (depositReserveLiquidity). */
export async function buildKaminoDepositTransaction(
  connection: Connection,
  user: PublicKey,
  usdcAmount: bigint
): Promise<Transaction> {
  if (usdcAmount <= 0n) throw new Error("deposit amount must be > 0");
  const market = await loadMarket(connection);
  const rpc = rpcFromConnection(connection);
  const ledger = await getCurrentLedgerInstant(rpc, "confirmed");
  const action = await KaminoAction.buildDepositReserveLiquidityTxns({
    kaminoMarket: market,
    amount: new BN(usdcAmount.toString()),
    reserveAddress: kitAddr(KAMINO_USDC_RESERVE),
    owner: createNoopSigner(kitAddr(user)),
    obligation: new VanillaObligation(PROGRAM_ID),
    scopeRefreshConfig: undefined,
    currentLedgerInstant: ledger,
    includeAtaIxs: true,
  });
  const tx = actionToTransaction(action);
  tx.feePayer = user;
  return tx;
}

/** Burn Kamino cUSDC → USDC (redeemReserveCollateral). */
export async function buildKaminoRedeemTransaction(
  connection: Connection,
  user: PublicKey,
  cTokenAmount: bigint
): Promise<Transaction> {
  if (cTokenAmount <= 0n) throw new Error("redeem amount must be > 0");
  const market = await loadMarket(connection);
  const rpc = rpcFromConnection(connection);
  const ledger = await getCurrentLedgerInstant(rpc, "confirmed");
  const action = await KaminoAction.buildRedeemReserveCollateralTxns({
    kaminoMarket: market,
    amount: new BN(cTokenAmount.toString()),
    reserveAddress: kitAddr(KAMINO_USDC_RESERVE),
    owner: createNoopSigner(kitAddr(user)),
    obligation: new VanillaObligation(PROGRAM_ID),
    scopeRefreshConfig: undefined,
    currentLedgerInstant: ledger,
    includeAtaIxs: true,
  });
  const tx = actionToTransaction(action);
  tx.feePayer = user;
  return tx;
}

/** True when the Kamino USDC reserve account is readable on this RPC. */
export async function isKaminoUsdcReserveLive(
  connection: Connection
): Promise<boolean> {
  const info = await connection.getAccountInfo(KAMINO_USDC_RESERVE);
  return info != null && info.owner.equals(KLEND_PROGRAM_ID);
}
