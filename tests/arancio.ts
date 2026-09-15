import { expect } from "chai";
import { Connection } from "@solana/web3.js";
import { createProviderConnection } from "./helpers/provider";

const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

describe("Arancio workspace", () => {
  it("workspace smoke test can read the provider cluster", async () => {
    const providerConnection = createProviderConnection();
    const mainnetConnection = new Connection(
      process.env.ARANCIO_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC_URL,
      "confirmed"
    );
    const [slot, providerGenesisHash, mainnetGenesisHash] = await Promise.all([
      providerConnection.getSlot("confirmed"),
      providerConnection.getGenesisHash(),
      mainnetConnection.getGenesisHash(),
    ]);

    expect(slot).to.be.a("number");
    expect(providerGenesisHash).to.equal(mainnetGenesisHash);
  });
});
