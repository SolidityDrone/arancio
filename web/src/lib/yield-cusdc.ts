import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { AnchorProvider, Program, BN } from "@anchor-lang/core";
import idl from "./yield_cusdc.json";

export const YIELD_CUSDC_PROGRAM_ID = new PublicKey(
  "7n7kW2mrLV8tSbriCChbTnggv1sA8nFwqGUamq65pNv8"
);

export function cusdcReservePda(usdcMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cusdc-reserve"), usdcMint.toBuffer()],
    YIELD_CUSDC_PROGRAM_ID
  )[0];
}

export function cusdcMintPda(usdcMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cusdc-mint"), usdcMint.toBuffer()],
    YIELD_CUSDC_PROGRAM_ID
  )[0];
}

export function cusdcVaultPda(usdcMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cusdc-vault"), usdcMint.toBuffer()],
    YIELD_CUSDC_PROGRAM_ID
  )[0];
}

function programFor(connection: Connection): Program {
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
  return new Program(idl as never, provider);
}

export async function isCusdcReserveInitialized(
  connection: Connection,
  usdcMint: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(cusdcReservePda(usdcMint));
  return info != null;
}

export async function buildInitializeCusdcReserveTransaction(
  connection: Connection,
  authority: PublicKey,
  usdcMint: PublicKey
): Promise<Transaction> {
  const program = programFor(connection);
  return program.methods
    .initializeReserve()
    .accountsPartial({
      authority,
      usdcMint,
      reserve: cusdcReservePda(usdcMint),
      cusdcMint: cusdcMintPda(usdcMint),
      vaultUsdc: cusdcVaultPda(usdcMint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
}

export async function buildCusdcDepositTransaction(
  connection: Connection,
  user: PublicKey,
  usdcMint: PublicKey,
  usdcAmount: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const cusdcMint = cusdcMintPda(usdcMint);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const userCusdc = getAssociatedTokenAddressSync(cusdcMint, user);
  const pre = [
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userCusdc,
      user,
      cusdcMint
    ),
  ];
  return program.methods
    .deposit(new BN(usdcAmount.toString()))
    .accountsPartial({
      user,
      usdcMint,
      reserve: cusdcReservePda(usdcMint),
      cusdcMint,
      vaultUsdc: cusdcVaultPda(usdcMint),
      userUsdc,
      userCusdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(pre)
    .transaction();
}

export async function buildCusdcRedeemTransaction(
  connection: Connection,
  user: PublicKey,
  usdcMint: PublicKey,
  cusdcAmount: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const cusdcMint = cusdcMintPda(usdcMint);
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const userCusdc = getAssociatedTokenAddressSync(cusdcMint, user);
  return program.methods
    .redeem(new BN(cusdcAmount.toString()))
    .accountsPartial({
      user,
      usdcMint,
      reserve: cusdcReservePda(usdcMint),
      cusdcMint,
      vaultUsdc: cusdcVaultPda(usdcMint),
      userUsdc,
      userCusdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
}

export async function buildAccrueInterestTransaction(
  connection: Connection,
  payer: PublicKey,
  usdcMint: PublicKey,
  usdcAmount: bigint
): Promise<Transaction> {
  const program = programFor(connection);
  const cusdcMint = cusdcMintPda(usdcMint);
  const payerUsdc = getAssociatedTokenAddressSync(usdcMint, payer);
  return program.methods
    .accrueInterest(new BN(usdcAmount.toString()))
    .accountsPartial({
      payer,
      usdcMint,
      reserve: cusdcReservePda(usdcMint),
      cusdcMint,
      vaultUsdc: cusdcVaultPda(usdcMint),
      payerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .transaction();
}

/** Preview USDC out for burning `cusdcAmount` shares. */
export function previewRedeemUsdc(
  vaultUsdc: bigint,
  cusdcSupply: bigint,
  cusdcAmount: bigint
): bigint {
  if (cusdcSupply <= 0n || cusdcAmount <= 0n) return 0n;
  return (vaultUsdc * cusdcAmount) / cusdcSupply;
}

export function previewDepositShares(
  vaultUsdc: bigint,
  cusdcSupply: bigint,
  usdcAmount: bigint
): bigint {
  if (usdcAmount <= 0n) return 0n;
  if (cusdcSupply === 0n) return usdcAmount;
  if (vaultUsdc === 0n) return usdcAmount;
  return (usdcAmount * cusdcSupply) / vaultUsdc;
}
