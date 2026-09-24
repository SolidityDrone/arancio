"use client";

import { useMemo } from "react";

/** 4-point sparkle star (24×24). */
export const STAR_PATH =
  "M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z";

const COLORS = ["#ffffff", "#14F195", "#C9A8FF", "#9945FF", "#DC1FFF", "#7CF7C8"];

/** Deterministic PRNG so server and client render the same field. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Props = {
  count: number;
  seed?: number;
  className?: string;
  minSize?: number;
  maxSize?: number;
};

/** A field of twinkling sparkles positioned inside the nearest positioned parent. */
export function SparkleField({ count, seed = 7, className = "", minSize = 7, maxSize = 18 }: Props) {
  const stars = useMemo(() => {
    const rnd = mulberry32(seed);
    return Array.from({ length: count }, (_, i) => ({
      i,
      left: rnd() * 100,
      top: rnd() * 100,
      size: minSize + rnd() * (maxSize - minSize),
      color: COLORS[Math.floor(rnd() * COLORS.length)],
      dur: 2.4 + rnd() * 3.2,
      delay: -rnd() * 6,
    }));
  }, [count, seed, minSize, maxSize]);

  return (
    <div className={`sparkle-field ${className}`.trim()} aria-hidden>
      {stars.map((s) => (
        <Sparkle
          key={s.i}
          style={
            {
              left: `${s.left}%`,
              top: `${s.top}%`,
              "--s": `${s.size}px`,
              "--c": s.color,
              "--d": `${s.dur}s`,
              "--delay": `${s.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Sparkle({ style, className = "" }: { style?: React.CSSProperties; className?: string }) {
  return (
    <svg className={`sparkle ${className}`.trim()} viewBox="0 0 24 24" style={style} aria-hidden>
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}
