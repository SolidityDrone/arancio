/** Brief pause so Surfpool RPC serves post-confirmation account data. */
export function delayForRpcSettle(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
