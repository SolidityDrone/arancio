import { expect } from "chai";
import BN from "bn.js";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { readFileSync } from "fs";
import { homedir } from "os";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import idl from "../target/idl/yield_cusdc.json";
import { createProviderConnection } from "./helpers/provider";

const PROGRAM_ID = new PublicKey(
  "7n7kW2mrLV8tSbriCChbTnggv1sA8nFwqGUamq65pNv8"
);

function loadWallet(): Wallet {
  const secret = Uint8Array.from(
    JSON.parse(
      readFileSync(
        process.env.ANCHOR_WALLET ?? `${homedir()}/.config/solana/id.json`,
        "utf8"
      )
    )
  );
  return new Wallet(Keypair.fromSecretKey(secret));
}

describe("yield_cusdc reserve (Kamino-shaped cUSDC)", () => {
  const connection = createProviderConnection();
  const wallet = loadWallet();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(idl as any, provider);

  it("deposits USDC, accrues interest without rebasing, redeems more USDC", async function () {
    this.timeout(120_000);

    const usdc = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const reserve = PublicKey.findProgramAddressSync(
      [Buffer.from("cusdc-reserve"), usdc.toBuffer()],
      PROGRAM_ID
    )[0];
    const cusdcMint = PublicKey.findProgramAddressSync(
      [Buffer.from("cusdc-mint"), usdc.toBuffer()],
      PROGRAM_ID
    )[0];
    const vaultUsdc = PublicKey.findProgramAddressSync(
      [Buffer.from("cusdc-vault"), usdc.toBuffer()],
      PROGRAM_ID
    )[0];

    await program.methods
      .initializeReserve()
      .accountsPartial({
        authority: wallet.publicKey,
        usdcMint: usdc,
        reserve,
        cusdcMint,
        vaultUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const userUsdc = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdc,
      wallet.publicKey
    );
    const userCusdc = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      cusdcMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      usdc,
      userUsdc.address,
      wallet.publicKey,
      1_000_000_000
    );

    await program.methods
      .deposit(new BN(100_000_000))
      .accountsPartial({
        user: wallet.publicKey,
        usdcMint: usdc,
        reserve,
        cusdcMint,
        vaultUsdc,
        userUsdc: userUsdc.address,
        userCusdc: userCusdc.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let cusdcBal = await getAccount(connection, userCusdc.address);
    expect(cusdcBal.amount).to.equal(100_000_000n);

    await program.methods
      .accrueInterest(new BN(10_000_000))
      .accountsPartial({
        payer: wallet.publicKey,
        usdcMint: usdc,
        reserve,
        cusdcMint,
        vaultUsdc,
        payerUsdc: userUsdc.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Balance does not rebase
    cusdcBal = await getAccount(connection, userCusdc.address);
    expect(cusdcBal.amount).to.equal(100_000_000n);

    const vaultBeforeRedeem = await getAccount(connection, vaultUsdc);
    expect(vaultBeforeRedeem.amount).to.equal(110_000_000n);

    await program.methods
      .redeem(new BN(100_000_000))
      .accountsPartial({
        user: wallet.publicKey,
        usdcMint: usdc,
        reserve,
        cusdcMint,
        vaultUsdc,
        userUsdc: userUsdc.address,
        userCusdc: userCusdc.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    cusdcBal = await getAccount(connection, userCusdc.address);
    expect(cusdcBal.amount).to.equal(0n);

    const userUsdcAfter = await getAccount(connection, userUsdc.address);
    // Started 1e9, deposited 1e8, accrued 1e7 from same wallet, redeemed 1.1e8
    // 1e9 - 1e8 - 1e7 + 1.1e8 = 1e9
    expect(userUsdcAfter.amount).to.equal(1_000_000_000n);
  });
});
