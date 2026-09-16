import { useEffect, useRef } from "react";

/**
 * Fluid tile-wave background (from superposition/app TileBackground),
 * recolored to Solana green gradients.
 *
 * A height field drives every tile: directional waves + pointer ripples.
 * Drawn on canvas ~30fps. prefers-reduced-motion → slower drift, no splashes.
 */

const TILE = 10;
const GAP = 0;
const PITCH = TILE + GAP;
const MAX_RIPPLES = 6;
const FRAME_MS = 1000 / 30;

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// deep green → Solana #14f195 → mint → near-white
const PALETTE: ([number, number, number] | null)[] = [
  null,
  [8, 72, 48],
  [12, 150, 95],
  [20, 241, 149],
  [170, 255, 215],
  [235, 255, 245],
];

type Wave = { dx: number; dy: number; len: number; speed: number; amp: number };

const WAVES: Wave[] = [
  { dx: 1, dy: 0.35, len: 380, speed: 1.15, amp: 1.0 },
  { dx: -0.55, dy: 1, len: 560, speed: 0.75, amp: 0.65 },
  { dx: 0.8, dy: -0.6, len: 240, speed: 1.7, amp: 0.35 },
];

type Ripple = { x: number; y: number; t0: number; amp: number };

export function SceneBackdrop({ opacity = 1 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let ripples: Ripple[] = [];
    let lastPointerRipple = 0;
    const dpr = 1;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeScale = reduced ? 0.3 : 1;

    function resize() {
      const parent = canvas!.parentElement;
      const rect = parent
        ? parent.getBoundingClientRect()
        : { width: window.innerWidth, height: window.innerHeight };
      w = rect.width || window.innerWidth;
      h = rect.height || window.innerHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / PITCH) + 2;
      rows = Math.ceil(h / PITCH) + 3;
    }

    function spawn(x: number, y: number, amp: number) {
      if (ripples.length >= MAX_RIPPLES) ripples.shift();
      ripples.push({ x, y, t0: vt, amp });
    }

    function spawnRandom() {
      spawn(
        w * (0.35 + Math.random() * 0.65),
        h * (0.1 + Math.random() * 0.8),
        1.0 + Math.random() * 0.6
      );
    }

    function heightAt(px: number, py: number, t: number): number {
      let sum = 0;
      for (const wv of WAVES) {
        const phase = (px * wv.dx + py * wv.dy) / wv.len + t * wv.speed;
        sum += wv.amp * Math.sin(phase * Math.PI * 2);
      }
      for (const rp of ripples) {
        const age = (t * 1000 - rp.t0) / 1000;
        const decay = Math.max(0, 1 - age / 3.2);
        if (decay <= 0) continue;
        const ring = age * 210;
        const d = Math.hypot(px - rp.x, py - rp.y);
        const g = Math.exp(-((d - ring) * (d - ring)) / (2 * 62 * 62));
        sum += rp.amp * g * decay * Math.cos((d - ring) / 14);
      }
      return sum;
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = c * PITCH + TILE / 2;
          const cy = r * PITCH + TILE / 2;
          const height = heightAt(cx, cy, t);
          const v = Math.min(1, Math.max(0, (height + 1.4) / 2.8));
          const b = (BAYER[r & 3][c & 3] + 0.5) / 16;
          let idx = Math.floor(v * PALETTE.length + b);
          if (idx < 0) idx = 0;
          if (idx >= PALETTE.length) idx = PALETTE.length - 1;
          const col = PALETTE[idx];
          if (!col) continue;
          ctx!.fillStyle = `rgb(${col[0]}, ${col[1]}, ${col[2]})`;
          ctx!.fillRect(c * PITCH, r * PITCH, TILE, TILE);
        }
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (reduced) return;
      const now = performance.now();
      if (now - lastPointerRipple < 140) return;
      const rect = canvas!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > w || y > h) return;
      lastPointerRipple = now;
      spawn(x, y, 1.5);
    }

    resize();
    let last = performance.now();
    let lastDraw = 0;
    let vt = 0;
    ripples = [
      { x: w * 0.8, y: h * 0.25, t0: -900, amp: 1.4 },
      { x: w * 0.55, y: h * 0.7, t0: -300, amp: 1.1 },
    ];

    function loop() {
      try {
        const now = performance.now();
        vt += (now - last) * timeScale;
        last = now;
        if (!document.hidden && now - lastDraw >= FRAME_MS) {
          lastDraw = now;
          ripples = ripples.filter((rp) => vt - rp.t0 < 3200);
          if (ripples.length < 3) spawnRandom();
          draw(vt / 1000);
        }
      } catch (err) {
        console.warn("[green-wave-bg] frame error", err);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      resize();
      draw(vt / 1000);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <>
      <div className="tile-bg" aria-hidden style={{ opacity }}>
        <canvas ref={canvasRef} />
      </div>
      <div className="hero-scrim" aria-hidden />
    </>
  );
}
