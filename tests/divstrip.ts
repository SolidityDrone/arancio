import { expect } from "chai";
import BN from "bn.js";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { readFileSync } from "fs";
import { homedir } from "os";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import idl from "../target/idl/divstrip.json";
import registryIdl from "../target/idl/ca_registry.json";
import { createProviderConnection } from "./helpers/provider";
import {
  encodeSyncPayload,
  KIND_YIELD,
  MULTIPLIER_SCALE,
} from "./helpers/xstocks-payload";

const DIVSTRIP_ID = new PublicKey(
  "A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz"
);
const REGISTRY_ID = new PublicKey(
  "2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z"
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

describe("divstrip", () => {
  const connection = createProviderConnection();
  const wallet = loadWallet();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const divstrip = new Program(idl as any, provider);
  const registry = new Program(registryIdl as any, provider);

  it("wraps underlying into PT+YT and unwraps at par", async function () {
    this.timeout(180_000);

    const underlying = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), underlying.toBuffer()],
      REGISTRY_ID
    )[0];

    await registry.methods
      .initializeRegistry("DEMO", PublicKey.default)
      .accountsPartial({
        authority: wallet.publicKey,
        mint: underlying,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // One synthetic yield event so nonce tip advances for later redeem tests.
    const payload = encodeSyncPayload(underlying, [
      {
        eventId: "demo-y1",
        caType: 0,
        kind: KIND_YIELD,
        effectiveTs: 1_700_000_000,
        multiplierOld: MULTIPLIER_SCALE,
        multiplierNew: (MULTIPLIER_SCALE * 101n) / 100n,
      },
    ]);
    await registry.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const market = PublicKey.findProgramAddressSync(
      [Buffer.from("strip"), underlying.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const vaultAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), market.toBuffer()],
      DIVSTRIP_ID
    )[0];

    await divstrip.methods
      .initializeStrip("DEMO", 1)
      .accountsPartial({
        authority: wallet.publicKey,
        underlyingMint: underlying,
        registry: registryPda,
        market,
        vaultAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const tip = await registry.account.registryLog.fetch(registryPda);
    const start = tip.currentYieldNonce as number;
    const target = start + 1;

    const startBuf = Buffer.alloc(4);
    startBuf.writeUInt32LE(start);
    const targetBuf = Buffer.alloc(4);
    targetBuf.writeUInt32LE(target);

    const series = PublicKey.findProgramAddressSync(
      [Buffer.from("series"), market.toBuffer(), startBuf, targetBuf],
      DIVSTRIP_ID
    )[0];
    const ptMint = PublicKey.findProgramAddressSync(
      [Buffer.from("pt-mint"), market.toBuffer(), startBuf, targetBuf],
      DIVSTRIP_ID
    )[0];
    const ytMint = PublicKey.findProgramAddressSync(
      [Buffer.from("yt-mint"), market.toBuffer(), startBuf, targetBuf],
      DIVSTRIP_ID
    )[0];

    await divstrip.methods
      .createSeries(start, target)
      .accountsPartial({
        payer: wallet.publicKey,
        market,
        registry: registryPda,
        series,
        ptMint,
        ytMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const userUnderlying = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      underlying,
      wallet.publicKey
    );
    await mintTo(
      connection,
      wallet.payer,
      underlying,
      userUnderlying.address,
      wallet.publicKey,
      1_000_000
    );

    const userPt = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      ptMint,
      wallet.publicKey
    );
    const userYt = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      ytMint,
      wallet.publicKey
    );
    const vaultUnderlying = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      underlying,
      vaultAuthority,
      true
    );

    await divstrip.methods
      .wrap(new BN(500_000))
      .accountsPartial({
        user: wallet.publicKey,
        market,
        registry: registryPda,
        series,
        underlyingMint: underlying,
        ptMint,
        ytMint,
        userUnderlying: userUnderlying.address,
        userPt: userPt.address,
        userYt: userYt.address,
        vaultUnderlying: vaultUnderlying.address,
        vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        ptTokenProgram: TOKEN_PROGRAM_ID,
        ytTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const ptAfter = await connection.getTokenAccountBalance(userPt.address);
    const ytAfter = await connection.getTokenAccountBalance(userYt.address);
    expect(ptAfter.value.amount).to.equal("500000");
    expect(ytAfter.value.amount).to.equal("500000");

    await divstrip.methods
      .unwrap(new BN(200_000))
      .accountsPartial({
        user: wallet.publicKey,
        market,
        series,
        underlyingMint: underlying,
        ptMint,
        ytMint,
        userUnderlying: userUnderlying.address,
        userPt: userPt.address,
        userYt: userYt.address,
        vaultUnderlying: vaultUnderlying.address,
        vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        ptTokenProgram: TOKEN_PROGRAM_ID,
        ytTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const ptFinal = await connection.getTokenAccountBalance(userPt.address);
    expect(ptFinal.value.amount).to.equal("300000");
  });
});
