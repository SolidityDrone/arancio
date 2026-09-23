import { expect } from "chai";
import { planGraduationYield } from "../web/src/lib/graduation-yield";
import {
  previewDepositShares,
  previewRedeemUsdc,
} from "../web/src/lib/yield-cusdc";

describe("rehydration accounting (unit)", () => {
  it("plans graduation B: migration seed + vault surplus, never parks", () => {
    const plan = planGraduationYield(1_100_000n, 1_000_000n);
    expect(plan.dammSeedUsdc).to.equal(1_000_000n);
    expect(plan.vaultBuyUsdc).to.equal(100_000n);
    expect(plan.dammSeedUsdc + plan.vaultBuyUsdc).to.equal(
      plan.totalUsdcFromCusdc
    );
  });

  it("when short of migration target, all USDC seeds DAMM", () => {
    const plan = planGraduationYield(800_000n, 1_000_000n);
    expect(plan.dammSeedUsdc).to.equal(800_000n);
    expect(plan.vaultBuyUsdc).to.equal(0n);
  });

  it("cUSDC exchange rate: fixed shares, rising USDC on redeem", () => {
    expect(previewDepositShares(0n, 0n, 100n)).to.equal(100n);
    expect(previewDepositShares(100n, 100n, 50n)).to.equal(50n);
    // After +10 interest on 100 vault / 100 supply
    expect(previewRedeemUsdc(110n, 100n, 100n)).to.equal(110n);
    expect(previewRedeemUsdc(110n, 100n, 50n)).to.equal(55n);
  });

  it("4626 late deposit gets fewer shares after donate (NAV up)", () => {
    // vault 100 curve, 100 shares → donate 50 → 150 assets / 100 shares
    const late = previewDepositShares(150n, 100n, 50n);
    expect(late).to.equal(33n); // floor(50 * 100 / 150)
    const earlyValue = previewRedeemUsdc(150n, 100n, 100n);
    expect(earlyValue).to.equal(150n);
  });
});
