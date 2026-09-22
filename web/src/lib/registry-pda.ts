import { PublicKey } from "@solana/web3.js";
import { CA_REGISTRY_PROGRAM_ID } from "./markets";

const REGISTRY_PROGRAM = new PublicKey(CA_REGISTRY_PROGRAM_ID);

export const MOCK_FORWARDER = new PublicKey(
  "jhCjuD4Z3V7HeSUChMRpkRwpw6B9yC63mxDMv8SdLNX"
);

export const REGISTRY_MISSING_HINT =
  "Re-run ./scripts/deploy-surfpool.sh (deploy + seed ca_registry for all desk markets).";

export function registryPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), mint.toBuffer()],
    REGISTRY_PROGRAM
  )[0];
}
