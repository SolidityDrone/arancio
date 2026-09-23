/** Session-only strip positions — not persisted. */

export type StoredStripPosition = {
  symbol: string;
  yieldNonce: number;
  /** @deprecated Legacy window positions — use yieldNonce (start). */
  startNonce?: number;
  targetNonce?: number;
  splitAt: number;
  signature?: string;
  amount?: string;
};

let positions: StoredStripPosition[] = [];

export function positionYieldNonce(p: StoredStripPosition): number {
  return p.yieldNonce ?? p.startNonce ?? 0;
}

export function loadStripPositions(): StoredStripPosition[] {
  return positions.slice();
}

export function saveStripPosition(position: StoredStripPosition) {
  const nonce = positionYieldNonce(position);
  const normalized = { ...position, yieldNonce: nonce };
  positions = [
    normalized,
    ...positions.filter(
      (p) =>
        !(p.symbol === normalized.symbol && positionYieldNonce(p) === nonce)
    ),
  ].slice(0, 60);
}

export function positionsForSymbol(symbol: string): StoredStripPosition[] {
  return loadStripPositions().filter((p) => p.symbol === symbol);
}
