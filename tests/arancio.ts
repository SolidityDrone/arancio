import { expect } from "chai";
import { createProviderConnection } from "./helpers/provider";

describe("Arancio workspace", () => {
  it("workspace smoke test can read the provider cluster", async () => {
    const slot = await createProviderConnection().getSlot("confirmed");

    expect(slot).to.be.a("number");
  });
});
