import { expect } from "chai";
import BN from "bn.js";
import { execSync } from "child_process";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { readFileSync } from "fs";
import { homedir } from "os";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../target/idl/ca_registry.json";
import { createProviderConnection } from "./helpers/provider";
import {
  encodeSyncPayload,
  fetchKoxHistory,
  KIND_SUPPLY,
  KIND_YIELD,
  koxHistoryFixture,
  KOX_MINT,
  MULTIPLIER_SCALE,
} from "./helpers/xstocks-payload";

const PROGRAM_ID = new PublicKey(
  "2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z"
);

const MOCK_FORWARDER_STATE = new PublicKey(
  "jhCjuD4Z3V7HeSUChMRpkRwpw6B9yC63mxDMv8SdLNX"
);

function loadLocalWallet(): Wallet {
  const walletPath =
    process.env.ANCHOR_WALLET ?? `${homedir()}/.config/solana/id.json`;
  const secret = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")));
  return new Wallet(Keypair.fromSecretKey(secret));
}

describe("ca_registry", () => {
  const connection = createProviderConnection();
  const wallet = loadLocalWallet();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program(idl as any, provider);

  it("updates cum_y / cum_s / yield_nonce for Yield vs Supply", async () => {
    const mint = Keypair.generate().publicKey;
    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), mint.toBuffer()],
      PROGRAM_ID
    )[0];

    await program.methods
      .initializeRegistry("FACT", Keypair.generate().publicKey)
      .accountsPartial({
        authority: wallet.publicKey,
        mint,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const afterInit = await program.account.registryLog.fetch(registryPda);
    expect(BigInt(afterInit.currentCumY.toString())).to.equal(MULTIPLIER_SCALE);
    expect(BigInt(afterInit.currentCumS.toString())).to.equal(MULTIPLIER_SCALE);
    expect(afterInit.currentYieldNonce).to.equal(0);

    const scale = MULTIPLIER_SCALE;
    const payload = encodeSyncPayload(mint, [
      {
        eventId: "yield-1",
        caType: 0, // CashDividend
        kind: KIND_YIELD,
        effectiveTs: 1_700_000_000,
        multiplierOld: scale,
        multiplierNew: (scale * 3n) / 2n, // 1.5e12
      },
      {
        eventId: "supply-1",
        caType: 2, // ForwardSplit
        kind: KIND_SUPPLY,
        effectiveTs: 1_700_000_100,
        multiplierOld: (scale * 3n) / 2n,
        multiplierNew: scale * 3n, // 3e12
      },
    ]);

    await program.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const registry = await program.account.registryLog.fetch(registryPda);
    expect(registry.eventCount).to.equal(2);
    expect(BigInt(registry.currentCumY.toString())).to.equal((scale * 3n) / 2n);
    expect(BigInt(registry.currentCumS.toString())).to.equal(scale * 2n);
    expect(registry.currentYieldNonce).to.equal(1);

    const events = registry.events as Array<{
      kind: number;
      cumY: BN;
      cumS: BN;
      yieldNonce: number;
    }>;
    expect(events[0].kind).to.equal(KIND_YIELD);
    expect(BigInt(events[0].cumY.toString())).to.equal((scale * 3n) / 2n);
    expect(BigInt(events[0].cumS.toString())).to.equal(scale);
    expect(events[0].yieldNonce).to.equal(1);

    expect(events[1].kind).to.equal(KIND_SUPPLY);
    expect(BigInt(events[1].cumY.toString())).to.equal((scale * 3n) / 2n);
    expect(BigInt(events[1].cumS.toString())).to.equal(scale * 2n);
    expect(events[1].yieldNonce).to.equal(1);
  });

  it("syncs corporate actions and resolves historical lookup", async () => {
    const mint = Keypair.generate().publicKey;
    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), mint.toBuffer()],
      PROGRAM_ID
    )[0];

    await program.methods
      .initializeRegistry("TEST", Keypair.generate().publicKey)
      .accountsPartial({
        authority: wallet.publicKey,
        mint,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const fixture = koxHistoryFixture();
    const payload = encodeSyncPayload(mint, fixture);

    await program.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const registry = await program.account.registryLog.fetch(registryPda);
    expect(registry.eventCount).to.equal(3);

    const lookup = await program.methods
      .lookupAt(new BN(1745000000))
      .accountsPartial({ registry: registryPda })
      .view();

    expect(lookup.caType).to.equal(0);
    expect(Number(lookup.effectiveTs)).to.equal(1741824900);

    await program.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const afterReplay = await program.account.registryLog.fetch(registryPda);
    expect(afterReplay.eventCount).to.equal(3);
  });

  it("backfills KOx history and resolves yield nonces", async function () {
    this.timeout(180_000);

    const mint = Keypair.generate().publicKey;
    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), mint.toBuffer()],
      PROGRAM_ID
    )[0];

    await program.methods
      .initializeRegistry("KOx", Keypair.generate().publicKey)
      .accountsPartial({
        authority: wallet.publicKey,
        mint,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const history = await fetchKoxHistory();
    expect(history.length).to.be.at.least(1);

    const payload = encodeSyncPayload(mint, history);
    await program.methods
      .syncEvents(Buffer.from(payload))
      .accountsPartial({
        authority: wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const registry = await program.account.registryLog.fetch(registryPda);
    expect(registry.eventCount).to.equal(history.length);

    const yieldCount = history.filter((e) => e.kind === KIND_YIELD).length;
    expect(registry.currentYieldNonce).to.equal(yieldCount);

    const firstYield = history.find((e) => e.kind === KIND_YIELD)!;
    const atNonce1 = await program.methods
      .eventAtYieldNonce(1)
      .accountsPartial({ registry: registryPda })
      .view();

    expect(atNonce1.kind).to.equal(KIND_YIELD);
    expect(atNonce1.yieldNonce).to.equal(1);
    expect(Number(atNonce1.effectiveTs)).to.equal(firstYield.effectiveTs);

    // Recompute expected cum_y after first yield from genesis tip.
    const ratio =
      (firstYield.multiplierNew * MULTIPLIER_SCALE) / firstYield.multiplierOld;
    const expectedCumY = (MULTIPLIER_SCALE * ratio) / MULTIPLIER_SCALE;
    expect(BigInt(atNonce1.cumY.toString())).to.equal(expectedCumY);

    if (history.length >= 2) {
      const midTs = history[0].effectiveTs + 1;
      const lookup = await program.methods
        .lookupAt(new BN(midTs))
        .accountsPartial({ registry: registryPda })
        .view();
      expect(Number(lookup.effectiveTs)).to.equal(history[0].effectiveTs);
    }
  });

  it("CRE dry-run WriteReport succeeds and payload syncs", async function () {
    this.timeout(180_000);

    const registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), KOX_MINT.toBuffer()],
      PROGRAM_ID
    )[0];

    const existing = await connection.getAccountInfo(registryPda);
    if (!existing) {
      await program.methods
        .initializeRegistry("KOx", MOCK_FORWARDER_STATE)
        .accountsPartial({
          authority: wallet.publicKey,
          mint: KOX_MINT,
          registry: registryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const before = await program.account.registryLog.fetch(registryPda);
    const beforeCount = before.eventCount as number;

    const simulateOutput = execSync(
      "cre workflow simulate xstocks-ca-sync --target staging-settings --non-interactive --trigger-index 0",
      {
        cwd: `${process.cwd()}/cre/orange-cre`,
        encoding: "utf8",
      }
    );

    expect(simulateOutput).to.match(/TX_STATUS_SUCCESS/);
    const payloadMatch = simulateOutput.match(/"PayloadBase64": "([^"]+)"/);
    expect(payloadMatch, "CRE simulate must emit PayloadBase64").to.not.be.null;

    const payload = Buffer.from(payloadMatch![1], "base64");
    await program.methods
      .syncEvents(payload)
      .accountsPartial({
        authority: wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const after = await program.account.registryLog.fetch(registryPda);
    expect(after.eventCount).to.be.at.least(beforeCount);
    expect(after.eventCount).to.be.at.least(1);
  });
});
