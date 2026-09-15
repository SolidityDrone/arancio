import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { loadAddressBook } from "../ts/client/addresses";
import {
  assertReserveMatchesComponent,
  discoverSupplyReserves,
} from "../ts/client/discovery";
import { createProviderConnection } from "./helpers/provider";

const marketValue = process.env.ARANCIO_KAMINO_MARKET;
if (!marketValue) {
  throw new Error("ARANCIO_KAMINO_MARKET must identify the live Kamino market");
}

const market = new PublicKey(marketValue);
const programValue = process.env.ARANCIO_PROGRAM_ID;
const addressBookValue = process.env.ARANCIO_ADDRESS_BOOK;

describe("live Kamino discovery", () => {
  if (programValue && addressBookValue) {
    it("loads the frozen deployment address book from chain state", async () => {
      const addressBook = await loadAddressBook(
        createProviderConnection(),
        new PublicKey(programValue),
        new PublicKey(addressBookValue)
      );

      expect(addressBook.frozen).to.equal(true);
      expect(addressBook.kaminoProgram.equals(PublicKey.default)).to.equal(
        false
      );
      expect(addressBook.jupiterProgram.equals(PublicKey.default)).to.equal(
        false
      );
      expect(addressBook.tokenProgram.equals(PublicKey.default)).to.equal(
        false
      );
      expect(addressBook.token2022Program.equals(PublicKey.default)).to.equal(
        false
      );
      expect(
        addressBook.associatedTokenProgram.equals(PublicKey.default)
      ).to.equal(false);
    });
  }

  it("returns reserves whose live accounts allow supply", async () => {
    const reserves = await discoverSupplyReserves(
      createProviderConnection(),
      market
    );

    expect(reserves.length).to.be.greaterThan(0);
    for (const reserve of reserves) {
      expect(reserve.market.equals(market)).to.equal(true);
      expect(reserve.liquidityMint.equals(PublicKey.default)).to.equal(false);
      expect(reserve.collateralMint.equals(PublicKey.default)).to.equal(false);
      expect(reserve.oracle.equals(PublicKey.default)).to.equal(false);
      expect(reserve.supplyEnabled).to.equal(true);
    }
  });

  it("rejects a component whose liquidity mint does not match", async () => {
    const [reserve] = await discoverSupplyReserves(
      createProviderConnection(),
      market
    );

    expect(() =>
      assertReserveMatchesComponent(reserve, PublicKey.default)
    ).to.throw(/liquidity mint/i);
  });
});
