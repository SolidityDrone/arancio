import { expect } from "chai";
import BN from "bn.js";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { readFileSync } from "fs";
import { homedir } from "os";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
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

describe("divstrip curve-YT vault", () => {
  const connection = createProviderConnection();
  const wallet = loadWallet();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const divstrip = new Program(idl as any, provider);
  const registry = new Program(registryIdl as any, provider);

  it("inits vault, deposits curve-YT, swaps strip YT for curve-YT", async function () {
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

    const curveYtMint = await createMint(
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
      .initializeRegistry("BRDG", PublicKey.default)
      .accountsPartial({
        authority: wallet.publicKey,
        mint: underlying,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const payload = encodeSyncPayload(underlying, [
      {
        eventId: "bridge-y1",
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
      .initializeStrip("BRDG", 1)
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
    const yieldNonce = tip.currentYieldNonce as number;
    const nonceBuf = Buffer.alloc(4);
    nonceBuf.writeUInt32LE(yieldNonce);

    const series = PublicKey.findProgramAddressSync(
      [Buffer.from("series"), market.toBuffer(), nonceBuf],
      DIVSTRIP_ID
    )[0];
    const ptMint = PublicKey.findProgramAddressSync(
      [Buffer.from("pt-mint"), market.toBuffer(), nonceBuf],
      DIVSTRIP_ID
    )[0];
    const ytMint = PublicKey.findProgramAddressSync(
      [Buffer.from("yt-mint"), market.toBuffer(), nonceBuf],
      DIVSTRIP_ID
    )[0];

    await divstrip.methods
      .createSeries(yieldNonce)
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

    const launch = PublicKey.findProgramAddressSync(
      [Buffer.from("curve-launch"), series.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const bridge = PublicKey.findProgramAddressSync(
      [Buffer.from("curve-bridge"), series.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const lcYtMint = PublicKey.findProgramAddressSync(
      [Buffer.from("lc-yt-mint"), series.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const fakePool = Keypair.generate().publicKey;

    const vaultStripYtAddr = getAssociatedTokenAddressSync(
      ytMint,
      bridge,
      true
    );
    const vaultCurveYtAddr = getAssociatedTokenAddressSync(
      curveYtMint,
      bridge,
      true
    );

    await divstrip.methods
      .registerCurveLaunch(
        curveYtMint,
        fakePool,
        20_000,
        new BN(5_000),
        new BN(75_000)
      )
      .accountsPartial({
        registrar: wallet.publicKey,
        market,
        series,
        launch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await divstrip.methods
      .initCurveBridge(curveYtMint)
      .accountsPartial({
        payer: wallet.publicKey,
        market,
        series,
        launch,
        bridge,
        bridgeAuthority: bridge,
        vaultStripYt: vaultStripYtAddr,
        vaultCurveYt: vaultCurveYtAddr,
        lcYtMint,
        stripYtMint: ytMint,
        curveYtMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
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
      .wrap(new BN(400_000))
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

    const userCurveYt = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      curveYtMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      curveYtMint,
      userCurveYt.address,
      wallet.publicKey,
      250_000
    );

    const userLcYt = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      lcYtMint,
      wallet.publicKey
    );

    await divstrip.methods
      .depositCurveYtForShares(new BN(200_000))
      .accountsPartial({
        user: wallet.publicKey,
        market,
        series,
        bridge,
        bridgeAuthority: bridge,
        curveYtMint,
        lcYtMint,
        userCurveYt: userCurveYt.address,
        userLcYt: userLcYt.address,
        vaultCurveYt: vaultCurveYtAddr,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const stripIn = new BN(100_000);
    const curveOut = new BN(100_000);
    const minCurve = new BN(95_000);

    await divstrip.methods
      .swapStripYtForCurveYt(stripIn, curveOut, minCurve)
      .accountsPartial({
        user: wallet.publicKey,
        market,
        series,
        bridge,
        bridgeAuthority: bridge,
        stripYtMint: ytMint,
        curveYtMint,
        userStripYt: userYt.address,
        userCurveYt: userCurveYt.address,
        vaultStripYt: vaultStripYtAddr,
        vaultCurveYt: vaultCurveYtAddr,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const ytBal = await connection.getTokenAccountBalance(userYt.address);
    const curveBal = await connection.getTokenAccountBalance(userCurveYt.address);
    const lcBal = await connection.getTokenAccountBalance(userLcYt.address);
    const vaultStripBal = await connection.getTokenAccountBalance(vaultStripYtAddr);
    const vaultCurveBal = await connection.getTokenAccountBalance(vaultCurveYtAddr);

    expect(ytBal.value.amount).to.equal("300000");
    expect(curveBal.value.amount).to.equal("150000");
    expect(lcBal.value.amount).to.equal("200000");
    expect(vaultStripBal.value.amount).to.equal("100000");
    expect(vaultCurveBal.value.amount).to.equal("100000");

    await divstrip.methods
      .redeemSharesForCurveYt(new BN(50_000))
      .accountsPartial({
        user: wallet.publicKey,
        market,
        series,
        bridge,
        bridgeAuthority: bridge,
        curveYtMint,
        lcYtMint,
        userCurveYt: userCurveYt.address,
        userLcYt: userLcYt.address,
        vaultCurveYt: vaultCurveYtAddr,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const lcAfter = await connection.getTokenAccountBalance(userLcYt.address);
    const curveAfter = await connection.getTokenAccountBalance(userCurveYt.address);
    const vaultCurveAfter = await connection.getTokenAccountBalance(
      vaultCurveYtAddr
    );
    expect(lcAfter.value.amount).to.equal("150000");
    expect(curveAfter.value.amount).to.equal("200000");
    expect(vaultCurveAfter.value.amount).to.equal("50000");
  });

  it("rejects swap when curve output below minimum", async function () {
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
    const curveYtMint = await createMint(
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
      .initializeRegistry("BRG2", PublicKey.default)
      .accountsPartial({
        authority: wallet.publicKey,
        mint: underlying,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
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
      .initializeStrip("BRG2", 1)
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
    const yieldNonce = tip.currentYieldNonce as number;
    const nonceBuf = Buffer.alloc(4);
    nonceBuf.writeUInt32LE(yieldNonce);

    const series = PublicKey.findProgramAddressSync(
      [Buffer.from("series"), market.toBuffer(), nonceBuf],
      DIVSTRIP_ID
    )[0];
    const ptMint = PublicKey.findProgramAddressSync(
      [Buffer.from("pt-mint"), market.toBuffer(), nonceBuf],
      DIVSTRIP_ID
    )[0];
    const ytMint = PublicKey.findProgramAddressSync(
      [Buffer.from("yt-mint"), market.toBuffer(), nonceBuf],
      DIVSTRIP_ID
    )[0];

    await divstrip.methods
      .createSeries(yieldNonce)
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

    const launch = PublicKey.findProgramAddressSync(
      [Buffer.from("curve-launch"), series.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const bridge = PublicKey.findProgramAddressSync(
      [Buffer.from("curve-bridge"), series.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const lcYtMint2 = PublicKey.findProgramAddressSync(
      [Buffer.from("lc-yt-mint"), series.toBuffer()],
      DIVSTRIP_ID
    )[0];
    const fakePool2 = Keypair.generate().publicKey;

    const vaultStripYtAddr2 = getAssociatedTokenAddressSync(
      ytMint,
      bridge,
      true
    );
    const vaultCurveYtAddr2 = getAssociatedTokenAddressSync(
      curveYtMint,
      bridge,
      true
    );

    await divstrip.methods
      .registerCurveLaunch(
        curveYtMint,
        fakePool2,
        20_000,
        new BN(5_000),
        new BN(75_000)
      )
      .accountsPartial({
        registrar: wallet.publicKey,
        market,
        series,
        launch,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await divstrip.methods
      .initCurveBridge(curveYtMint)
      .accountsPartial({
        payer: wallet.publicKey,
        market,
        series,
        launch,
        bridge,
        bridgeAuthority: bridge,
        vaultStripYt: vaultStripYtAddr2,
        vaultCurveYt: vaultCurveYtAddr2,
        lcYtMint: lcYtMint2,
        stripYtMint: ytMint,
        curveYtMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const userYt = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      ytMint,
      wallet.publicKey
    );
    const userCurveYt = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      curveYtMint,
      wallet.publicKey
    );
    await mintTo(
      connection,
      wallet.payer,
      curveYtMint,
      vaultCurveYtAddr2,
      wallet.publicKey,
      50_000
    );

    let failed = false;
    try {
      await divstrip.methods
        .swapStripYtForCurveYt(new BN(10_000), new BN(10_000), new BN(20_000))
        .accountsPartial({
          user: wallet.publicKey,
          market,
          series,
          bridge,
          bridgeAuthority: bridge,
          stripYtMint: ytMint,
          curveYtMint,
          userStripYt: userYt.address,
          userCurveYt: userCurveYt.address,
          vaultStripYt: vaultStripYtAddr2,
          vaultCurveYt: vaultCurveYtAddr2,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
  });
});
