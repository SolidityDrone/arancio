const POSITIONS_KEY = "divstrip.strip.positions.v1";

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

export function positionYieldNonce(p: StoredStripPosition): number {
  return p.yieldNonce ?? p.startNonce ?? 0;
}

export function loadStripPositions(): StoredStripPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(
      localStorage.getItem(POSITIONS_KEY) ?? "[]"
    ) as StoredStripPosition[];
    return raw.map((p) => ({ ...p, yieldNonce: positionYieldNonce(p) }));
  } catch {
    return [];
  }
}

export function saveStripPosition(position: StoredStripPosition) {
  const nonce = positionYieldNonce(position);
  const normalized = { ...position, yieldNonce: nonce };
  const all = loadStripPositions().filter(
    (p) =>
      !(
        p.symbol === normalized.symbol && positionYieldNonce(p) === nonce
      )
  );
  all.unshift(normalized);
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(all.slice(0, 60)));
}

export function positionsForSymbol(symbol: string): StoredStripPosition[] {
  return loadStripPositions().filter((p) => p.symbol === symbol);
}
