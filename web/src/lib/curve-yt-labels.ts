/**
 * Meteora DBC trades a separate SPL token (on-chain symbol may look like YTKOx0).
 * UI always calls it curve-YT / cYT· to distinguish from DivStrip strip YT.
 */

/** Short ticker shown on buttons and swap rows, e.g. cYT·KOx */
export function curveYtTicker(stockSymbol: string): string {
  return `cYT·${stockSymbol}`;
}

/** Vault share receipt after buying curve via the curve-YT vault proxy. */
export function lcYtTicker(stockSymbol: string): string {
  return `lcYT·${stockSymbol}`;
}

/** Full window label, e.g. curve-YT · KOx · n0→n2 */
export function curveYtWindowLabel(
  stockSymbol: string,
  start: number,
  target: number
): string {
  return `curve-YT · ${stockSymbol} · n${start}→n${target}`;
}

export const CURVE_YT_CALLOUT =
  "curve-YT is a Meteora pool token for USDC price discovery — not strip YT from splitting xStock.";

export const STRIP_YT_CALLOUT =
  "strip YT is minted 1:1 when you split xStock on DivStrip (PT + strip YT).";
