const POSITIONS_KEY = "divstrip.strip.positions.v1";

export type StoredStripPosition = {
  symbol: string;
  startNonce: number;
  targetNonce: number;
  splitAt: number;
  signature?: string;
  amount?: string;
};

export function loadStripPositions(): StoredStripPosition[] {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveStripPosition(position: StoredStripPosition) {
  const all = loadStripPositions().filter(
    (p) =>
      !(
        p.symbol === position.symbol &&
        p.startNonce === position.startNonce &&
        p.targetNonce === position.targetNonce
      )
  );
  all.unshift(position);
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(all.slice(0, 60)));
}

export function positionsForSymbol(symbol: string): StoredStripPosition[] {
  return loadStripPositions().filter((p) => p.symbol === symbol);
}
