import { useState } from "react";
import { marketLogo } from "../lib/markets";

type Props = {
  symbol: string;
  name?: string;
  size?: number;
  className?: string;
};

export function StockLogo({ symbol, name, size = 28, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const label = name ?? symbol;

  if (failed) {
    return (
      <span
        className={`stock-logo stock-logo-fallback ${className}`.trim()}
        style={{ width: size, height: size, fontSize: size * 0.32 }}
        aria-hidden
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }

  return (
    <img
      className={`stock-logo ${className}`.trim()}
      src={marketLogo(symbol)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      title={label}
      onError={() => setFailed(true)}
    />
  );
}
