import { Connection } from "@solana/web3.js";

const DEFAULT_RPC_URL = "http://127.0.0.1:8899";

export function createProviderConnection(): Connection {
  const rpcUrl = process.env.ARANCIO_RPC_URL ?? DEFAULT_RPC_URL;

  return new Connection(rpcUrl, "confirmed");
}
