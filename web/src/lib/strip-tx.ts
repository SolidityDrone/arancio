import { BN, Program, AnchorProvider } from "@anchor-lang/core";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "./divstrip.json";
import { DIVSTRIP_PROGRAM_ID } from "./markets";
import { registryPda } from "./seed-registry";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

export type StripWindow = {
  underlyingMint: PublicKey;
  startNonce: number;
  targetNonce: number;
};

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

function vaultAuthority(market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

function stripAccounts(wallet: PublicKey, window: StripWindow) {
  const market = marketPda(window.underlyingMint);
  const series = seriesPda(market, window.startNonce, window.targetNonce);
  const ptMint = ptMintPda(market, window.startNonce, window.targetNonce);
  const ytMint = ytMintPda(market, window.startNonce, window.targetNonce);
  const vaultAuth = vaultAuthority(market);
  const token2022 = TOKEN_2022_PROGRAM_ID;
  const userUnderlying = getAssociatedTokenAddressSync(
    window.underlyingMint,
    wallet,
    false,
    token2022
  );
  const userPt = getAssociatedTokenAddressSync(
    ptMint,
    wallet,
    false,
    TOKEN_PROGRAM_ID
  );
  const userYt = getAssociatedTokenAddressSync(
    ytMint,
    wallet,
    false,
    TOKEN_PROGRAM_ID
  );
  const vaultUnderlying = getAssociatedTokenAddressSync(
    window.underlyingMint,
    vaultAuth,
    true,
    token2022
  );
  const registry = registryPda(window.underlyingMint);
  return {
    market,
    series,
    ptMint,
    ytMint,
    vaultAuth,
    token2022,
    userUnderlying,
    userPt,
    userYt,
    vaultUnderlying,
    registry,
  };
}

function programFor(connection: Connection) {
  const provider = new AnchorProvider(
    connection,
    {} as never,
    AnchorProvider.defaultOptions()
  );
  return new Program(idl as never, provider);
}

function underlyingAtaIx(
  wallet: PublicKey,
  underlyingMint: PublicKey,
  ata: PublicKey
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    wallet,
    ata,
    wallet,
    underlyingMint,
    TOKEN_2022_PROGRAM_ID
  );
}

/** Burn equal PT + YT; receive underlying 1:1. */
export async function buildUnwrapTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  amountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = stripAccounts(wallet, window);
  return program.methods
    .unwrap(new BN(amountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      series: a.series,
      underlyingMint: window.underlyingMint,
      ptMint: a.ptMint,
      ytMint: a.ytMint,
      userUnderlying: a.userUnderlying,
      userPt: a.userPt,
      userYt: a.userYt,
      vaultUnderlying: a.vaultUnderlying,
      vaultAuthority: a.vaultAuth,
      tokenProgram: a.token2022,
      ptTokenProgram: TOKEN_PROGRAM_ID,
      ytTokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      underlyingAtaIx(wallet, window.underlyingMint, a.userUnderlying),
    ])
    .transaction();
}

/** Mature window: burn PT for capital share of underlying. */
export async function buildRedeemCapitalTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  amountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = stripAccounts(wallet, window);
  return program.methods
    .redeemCapital(new BN(amountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      registry: a.registry,
      series: a.series,
      underlyingMint: window.underlyingMint,
      legMint: a.ptMint,
      userLeg: a.userPt,
      userUnderlying: a.userUnderlying,
      vaultUnderlying: a.vaultUnderlying,
      vaultAuthority: a.vaultAuth,
      tokenProgram: a.token2022,
      legTokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      underlyingAtaIx(wallet, window.underlyingMint, a.userUnderlying),
    ])
    .transaction();
}

/** Mature window: burn YT for coupon share of underlying. */
export async function buildRedeemYieldTransaction(
  connection: Connection,
  wallet: PublicKey,
  window: StripWindow,
  amountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = stripAccounts(wallet, window);
  return program.methods
    .redeemYield(new BN(amountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      registry: a.registry,
      series: a.series,
      underlyingMint: window.underlyingMint,
      legMint: a.ytMint,
      userLeg: a.userYt,
      userUnderlying: a.userUnderlying,
      vaultUnderlying: a.vaultUnderlying,
      vaultAuthority: a.vaultAuth,
      tokenProgram: a.token2022,
      legTokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      underlyingAtaIx(wallet, window.underlyingMint, a.userUnderlying),
    ])
    .transaction();
}
