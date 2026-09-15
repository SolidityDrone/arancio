import { expect } from "chai";
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { loadAddressBook } from "../ts/client/addresses";
import {
  assertReserveMatchesComponent,
  decodeReserveAccount,
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

const key = (value: number) => new PublicKey(Buffer.alloc(32, value));
const reserveProgram = key(7);
const reserveMarket = key(8);
const reserveAddress = key(9);
const liquidityMint = key(10);
const collateralMint = key(11);
const oracle = key(12);
const tokenProgram = key(13);

const writePublicKey = (data: Buffer, offset: number, value: PublicKey) => {
  value.toBuffer().copy(data, offset);
};

const writeU64 = (data: Buffer, offset: number, value: number) => {
  data.writeUInt32LE(value, offset);
  data.writeUInt32LE(0, offset + 4);
};

const reserveLayout = {
  accountBytes: 8624,
  liquidityOffset: 128,
  collateralOffset: 128 + 3 * 32 + 8 + 16 * 2 + 8 * 4 + 8 * 6 + 16 * 4 + 32 + 8 * 51 + 16 * 32 + 8 * 150,
  configOffset: 128 + 3 * 32 + 8 + 16 * 2 + 8 * 4 + 8 * 6 + 16 * 4 + 32 + 8 * 51 + 16 * 32 + 8 * 150 + 32 + 8 + 32 + 16 * 64 + 8 * 150,
};

const reserveData = (options?: {
  market?: PublicKey;
  supplied?: number;
  available?: number;
  depositLimitCrossed?: number;
  collateral?: PublicKey;
  oracle?: PublicKey;
  tokenProgram?: PublicKey;
  discriminator?: Buffer;
}) => {
  const data = Buffer.alloc(reserveLayout.accountBytes);
  const discriminator =
    options?.discriminator ??
    createHash("sha256")
      .update("account:Reserve")
      .digest()
      .subarray(0, 8);
  discriminator.copy(data, 0);
  writePublicKey(data, 32, options?.market ?? reserveMarket);
  writePublicKey(data, reserveLayout.liquidityOffset, liquidityMint);
  writeU64(data, reserveLayout.liquidityOffset + 96, options?.supplied ?? 100);
  writeU64(data, reserveLayout.liquidityOffset + 88, options?.available ?? 1);
  writeU64(
    data,
    reserveLayout.liquidityOffset + 152,
    options?.depositLimitCrossed ?? 0
  );
  writePublicKey(data, reserveLayout.liquidityOffset + 280, options?.tokenProgram ?? tokenProgram);
  writePublicKey(data, reserveLayout.collateralOffset, options?.collateral ?? collateralMint);
  data[reserveLayout.configOffset] = 0;
  writeU64(data, reserveLayout.configOffset + 160, 100);
  writePublicKey(
    data,
    reserveLayout.configOffset + 4 + 10 + 4 + 6 + 16 + 24 + 88 + 8 * 3 + 32 + 24 + 8 * 3,
    options?.oracle ?? oracle
  );
  return data;
};

const addressBookData = (discriminator: Buffer) => {
  const data = Buffer.alloc(8 + 32 * 6 + 1);
  discriminator.copy(data, 0);
  return data;
};

describe("live Kamino discovery", () => {
  it("loads the frozen deployment address book from chain state", async function () {
    if (!programValue || !addressBookValue) {
      this.skip();
    }

    const addressBook = await loadAddressBook(
      createProviderConnection(),
      new PublicKey(programValue!),
      new PublicKey(addressBookValue!)
    );

    expect(addressBook.frozen).to.equal(true);
    expect(addressBook.kaminoProgram.equals(PublicKey.default)).to.equal(false);
    expect(addressBook.jupiterProgram.equals(PublicKey.default)).to.equal(false);
    expect(addressBook.tokenProgram.equals(PublicKey.default)).to.equal(false);
    expect(addressBook.token2022Program.equals(PublicKey.default)).to.equal(false);
    expect(addressBook.associatedTokenProgram.equals(PublicKey.default)).to.equal(false);
  });

  it("returns reserves whose live accounts allow supply", async function () {
    this.timeout(120_000);
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

  it("rejects a component whose liquidity mint does not match", async function () {
    this.timeout(120_000);
    const [reserve] = await discoverSupplyReserves(
      createProviderConnection(),
      market
    );

    expect(() =>
      assertReserveMatchesComponent(reserve, {
        market,
        liquidityMint: PublicKey.default,
        collateralMint: reserve.collateralMint,
        oracle: reserve.oracle,
        tokenProgram: reserve.tokenProgram,
      })
    ).to.throw(/liquidity mint/i);
  });
});

describe("reserve and address-book parsers", () => {
  it("uses total supplied liquidity when checking the deposit limit", () => {
    const reserve = decodeReserveAccount(
      reserveData({ supplied: 100, available: 1 }),
      reserveMarket,
      reserveAddress,
      reserveProgram
    );

    expect(reserve?.supplyEnabled).to.equal(false);
  });

  it("retains Kamino's deposit-limit-crossed check", () => {
    const reserve = decodeReserveAccount(
      reserveData({ supplied: 1, available: 1, depositLimitCrossed: 1 }),
      reserveMarket,
      reserveAddress,
      reserveProgram
    );

    expect(reserve?.supplyEnabled).to.equal(false);
  });

  it("rejects malformed reserve account data", () => {
    expect(
      decodeReserveAccount(Buffer.alloc(16), reserveMarket, reserveAddress, reserveProgram)
    ).to.equal(null);
  });

  it("rejects a reserve with Kamino's null oracle sentinel", () => {
    const reserve = decodeReserveAccount(
      reserveData({ oracle: new PublicKey("11111111111111111111111111111111") }),
      reserveMarket,
      reserveAddress,
      reserveProgram
    );

    expect(reserve).to.equal(null);
  });

  it("rejects an address book with a non-Anchor discriminator", async () => {
    const connection = {
      getAccountInfo: async () => ({
        data: addressBookData(Buffer.alloc(8)),
        owner: reserveProgram,
      }),
    } as any;

    try {
      await loadAddressBook(connection, reserveProgram, reserveAddress);
    } catch (error: any) {
      expect(error.message).to.match(/discriminator/i);
      return;
    }
    throw new Error("expected invalid address-book discriminator to be rejected");
  });

  it("rejects every mismatched reserve identity", () => {
    const reserve = {
      market: reserveMarket,
      reserve: reserveAddress,
      liquidityMint,
      collateralMint,
      oracle,
      tokenProgram,
      supplyEnabled: true,
    };
    const expected = {
      market: reserveMarket,
      liquidityMint,
      collateralMint,
      oracle,
      tokenProgram,
    };

    expect(() => assertReserveMatchesComponent(reserve, { ...expected, market: key(20) })).to.throw(/market/i);
    expect(() => assertReserveMatchesComponent(reserve, { ...expected, liquidityMint: key(21) })).to.throw(/liquidity mint/i);
    expect(() => assertReserveMatchesComponent(reserve, { ...expected, collateralMint: key(22) })).to.throw(/collateral mint/i);
    expect(() => assertReserveMatchesComponent(reserve, { ...expected, oracle: key(23) })).to.throw(/oracle/i);
    expect(() => assertReserveMatchesComponent(reserve, { ...expected, tokenProgram: key(24) })).to.throw(/token program/i);
  });

  it("accepts a reserve when all component identities match", () => {
    const expected = {
      market: reserveMarket,
      liquidityMint,
      collateralMint,
      oracle,
      tokenProgram,
    };

    expect(() =>
      assertReserveMatchesComponent(
        {
          ...expected,
          reserve: reserveAddress,
          supplyEnabled: true,
        },
        expected
      )
    ).not.to.throw();
  });
});
