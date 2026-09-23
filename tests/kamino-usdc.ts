import { expect } from "chai";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  KAMINO_CUSDC_MINT,
  KAMINO_MAIN_MARKET,
  KAMINO_USDC_RESERVE,
  KLEND_PROGRAM_ID,
  buildKaminoDepositTransaction,
  buildKaminoRedeemTransaction,
  fetchKaminoUsdcSnapshot,
  isKaminoUsdcReserveLive,
  previewKaminoRedeem,
  yieldQuoteMint,
} from "../web/src/lib/kamino-usdc";
import { USDC_MINT } from "../web/src/lib/meteora-dbc";
import { createProviderConnection } from "./helpers/provider";

describe("kamino USDC cToken (main market)", () => {
  const connection = createProviderConnection();

  it("DBC quote mint is native USDC; Kamino cUSDC is vault inventory only", () => {
    expect(yieldQuoteMint(USDC_MINT).equals(USDC_MINT)).to.equal(true);
    expect(KAMINO_CUSDC_MINT.toBase58()).to.equal(
      "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"
    );
    expect(KAMINO_MAIN_MARKET.toBase58()).to.equal(
      "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
    );
    expect(KAMINO_USDC_RESERVE.toBase58()).to.equal(
      "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
    );
  });

  it("loads live reserve snapshot and redeem preview on Surfpool/mainnet RPC", async function () {
    this.timeout(120_000);
    const live = await isKaminoUsdcReserveLive(connection);
    if (!live) {
      this.skip();
      return;
    }
    const owner = await connection.getAccountInfo(KAMINO_USDC_RESERVE);
    expect(owner?.owner.equals(KLEND_PROGRAM_ID)).to.equal(true);

    const snap = await fetchKaminoUsdcSnapshot(connection);
    expect(snap.cTokenMint).to.equal(KAMINO_CUSDC_MINT.toBase58());
    expect(snap.liquidityMint).to.equal(USDC_MINT.toBase58());
    expect(snap.usdcPerCtoken).to.be.greaterThan(1);
    expect(snap.supplyApy).to.be.greaterThan(0);
    expect(snap.supplyApy).to.be.lessThan(1);

    const oneC = 1_000_000n;
    const preview = await previewKaminoRedeem(connection, oneC);
    expect(Number(preview.redeemableUsdc)).to.be.greaterThan(Number(oneC));
    expect(preview.accruedVsPar).to.equal(preview.redeemableUsdc - oneC);
  });

  it("builds depositReserveLiquidity + redeemReserveCollateral txs", async function () {
    this.timeout(120_000);
    if (!(await isKaminoUsdcReserveLive(connection))) {
      this.skip();
      return;
    }
    const user = Keypair.generate().publicKey;
    const dep = await buildKaminoDepositTransaction(
      connection,
      user,
      1_000_000n
    );
    expect(dep.instructions.length).to.be.greaterThan(0);
    expect(
      dep.instructions.some((ix) => ix.programId.equals(KLEND_PROGRAM_ID))
    ).to.equal(true);

    const red = await buildKaminoRedeemTransaction(
      connection,
      user,
      1_000_000n
    );
    expect(red.instructions.length).to.be.greaterThan(0);
    expect(
      red.instructions.some((ix) => ix.programId.equals(KLEND_PROGRAM_ID))
    ).to.equal(true);
  });
});
