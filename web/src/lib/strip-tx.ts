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
import { registryPda } from "./registry-pda";

const PROGRAM_ID = new PublicKey(DIVSTRIP_PROGRAM_ID);

/** One strip series per dividend yield nonce (coupon step `k → k+1`). */
export type StripSeriesRef = {
  underlyingMint: PublicKey;
  yieldNonce: number;
};

/** @deprecated Use StripSeriesRef — kept for incremental migration. */
export type StripWindow = StripSeriesRef;

function nonceBuf(n: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n);
  return buf;
}

export function marketPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strip"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function seriesPda(market: PublicKey, yieldNonce: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("series"), market.toBuffer(), nonceBuf(yieldNonce)],
    PROGRAM_ID
  )[0];
}

export function ptMintPda(market: PublicKey, yieldNonce: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pt-mint"), market.toBuffer(), nonceBuf(yieldNonce)],
    PROGRAM_ID
  )[0];
}

export function ytMintPda(market: PublicKey, yieldNonce: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yt-mint"), market.toBuffer(), nonceBuf(yieldNonce)],
    PROGRAM_ID
  )[0];
}

function vaultAuthority(market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PROGRAM_ID
  )[0];
}

function stripAccounts(wallet: PublicKey, series: StripSeriesRef) {
  const market = marketPda(series.underlyingMint);
  const seriesPdaKey = seriesPda(market, series.yieldNonce);
  const ptMint = ptMintPda(market, series.yieldNonce);
  const ytMint = ytMintPda(market, series.yieldNonce);
  const vaultAuth = vaultAuthority(market);
  const token2022 = TOKEN_2022_PROGRAM_ID;
  const userUnderlying = getAssociatedTokenAddressSync(
    series.underlyingMint,
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
    series.underlyingMint,
    vaultAuth,
    true,
    token2022
  );
  const registry = registryPda(series.underlyingMint);
  return {
    market,
    series: seriesPdaKey,
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
  series: StripSeriesRef,
  amountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = stripAccounts(wallet, series);
  return program.methods
    .unwrap(new BN(amountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      series: a.series,
      underlyingMint: series.underlyingMint,
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
      underlyingAtaIx(wallet, series.underlyingMint, a.userUnderlying),
    ])
    .transaction();
}

/** Mature nonce: burn PT for capital share of underlying. */
export async function buildRedeemCapitalTransaction(
  connection: Connection,
  wallet: PublicKey,
  series: StripSeriesRef,
  amountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = stripAccounts(wallet, series);
  return program.methods
    .redeemCapital(new BN(amountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      registry: a.registry,
      series: a.series,
      underlyingMint: series.underlyingMint,
      legMint: a.ptMint,
      userLeg: a.userPt,
      userUnderlying: a.userUnderlying,
      vaultUnderlying: a.vaultUnderlying,
      vaultAuthority: a.vaultAuth,
      tokenProgram: a.token2022,
      legTokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      underlyingAtaIx(wallet, series.underlyingMint, a.userUnderlying),
    ])
    .transaction();
}

/** Mature nonce: burn YT for coupon share of underlying. */
export async function buildRedeemYieldTransaction(
  connection: Connection,
  wallet: PublicKey,
  series: StripSeriesRef,
  amountRaw: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const a = stripAccounts(wallet, series);
  return program.methods
    .redeemYield(new BN(amountRaw.toString()))
    .accountsPartial({
      user: wallet,
      market: a.market,
      registry: a.registry,
      series: a.series,
      underlyingMint: series.underlyingMint,
      legMint: a.ytMint,
      userLeg: a.userYt,
      userUnderlying: a.userUnderlying,
      vaultUnderlying: a.vaultUnderlying,
      vaultAuthority: a.vaultAuth,
      tokenProgram: a.token2022,
      legTokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      underlyingAtaIx(wallet, series.underlyingMint, a.userUnderlying),
    ])
    .transaction();
}
