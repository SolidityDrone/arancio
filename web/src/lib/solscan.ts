export function solscanTxUrl(signature: string, rpcEndpoint: string): string {
  const sig = signature.trim();
  if (!sig) return "https://solscan.io";

  const rpc = rpcEndpoint.toLowerCase();
  if (rpc.includes("127.0.0.1") || rpc.includes("localhost")) {
    const custom = encodeURIComponent(rpcEndpoint);
    return `https://solscan.io/tx/${sig}?cluster=custom&customUrl=${custom}`;
  }
  if (rpc.includes("devnet")) {
    return `https://solscan.io/tx/${sig}?cluster=devnet`;
  }
  if (rpc.includes("testnet")) {
    return `https://solscan.io/tx/${sig}?cluster=testnet`;
  }
  return `https://solscan.io/tx/${sig}`;
}
