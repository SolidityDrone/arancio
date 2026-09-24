import { useEffect, useRef } from "react";

/**
 * 2.5D tile-wave background: a height field (directional waves + pointer
 * ripples) lifts a grid of tiny extruded blocks. Height drives both the
 * extrusion depth and the Solana purple → green color ramp.
 * Drawn on canvas ~30fps. prefers-reduced-motion → slower drift, no splashes.
 */

const TILE = 13;
const PITCH = 16;
const MAX_RIPPLES = 6;
const FRAME_MS = 1000 / 30;
/** Tiles below this normalized height stay empty so the hero copy breathes. */
const FLOOR = 0.34;
const MAX_DEPTH = 9;

// Height → color ramp: deep violet → Solana purple → blue-violet → Solana green.
const RAMP: [number, [number, number, number]][] = [
  [FLOOR, [38, 22, 84]],
  [0.56, [153, 69, 255]],
  [0.8, [96, 150, 240]],
  [1, [20, 241, 149]],
];

function rampColor(v: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    const [v1, c1] = RAMP[i];
    if (v <= v1) {
      const [v0, c0] = RAMP[i - 1];
      const k = (v - v0) / (v1 - v0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function rgb(c: [number, number, number], k: number, a: number) {
  return `rgba(${Math.min(255, c[0] * k) | 0}, ${Math.min(255, c[1] * k) | 0}, ${
    Math.min(255, c[2] * k) | 0
  }, ${a})`;
}

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
    let running = false;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let ripples: Ripple[] = [];
    let lastPointerRipple = 0;
    const dpr = 1;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeScale = reduced ? 0.3 : 1;
    const mountedAt = performance.now();
    const TAU = Math.PI * 2;
    const HALF = TILE / 2;

    // Waves are separable: sin(A_col + B_row) = sinA·cosB + cosA·sinB.
    // Column terms are static; row terms change once per frame.
    let colSin: Float32Array[] = [];
    let colCos: Float32Array[] = [];
    let rowSin: Float32Array[] = [];
    let rowCos: Float32Array[] = [];

    // Pre-built fill strings for 256 height levels (top / right / front faces).
    const LEVELS = 256;
    const topFill: string[] = [];
    const sideFill: string[] = [];
    const frontFill: string[] = [];
    for (let i = 0; i < LEVELS; i++) {
      const v = FLOOR + ((1 - FLOOR) * i) / (LEVELS - 1);
      const k = (v - FLOOR) / (1 - FLOOR);
      const col = rampColor(v);
      const a = 0.35 + k * 0.65;
      topFill.push(rgb(col, 1.35, a));
      sideFill.push(rgb(col, 0.5, a));
      frontFill.push(rgb(col, 0.9, a));
    }

    // Opaque hero schema panel: tiles fully behind it are never visible.
    let occ: { l: number; t: number; r: number; b: number } | null = null;
    const OCC_INSET = 26; // covers the panel's cursor tilt
    function measureOccluder() {
      const frame = document.querySelector(".hero-stage-frame");
      if (!frame || performance.now() - mountedAt < 1600) {
        occ = null;
        return;
      }
      const cr = canvas!.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      occ = {
        l: fr.left - cr.left + OCC_INSET,
        t: fr.top - cr.top + OCC_INSET,
        r: fr.right - cr.left - OCC_INSET,
        b: fr.bottom - cr.top - OCC_INSET,
      };
    }

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
      colSin = WAVES.map(() => new Float32Array(cols));
      colCos = WAVES.map(() => new Float32Array(cols));
      rowSin = WAVES.map(() => new Float32Array(rows));
      rowCos = WAVES.map(() => new Float32Array(rows));
      WAVES.forEach((wv, wi) => {
        for (let c = 0; c < cols; c++) {
          const a = (TAU * ((c * PITCH + HALF) * wv.dx)) / wv.len;
          colSin[wi][c] = Math.sin(a);
          colCos[wi][c] = Math.cos(a);
        }
      });
      measureOccluder();
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

    // Gaussian ring (sigma 62) is negligible beyond ~3.5 sigma.
    const RING_REACH = 62 * 3.5;
    const RING_DENOM = 2 * 62 * 62;

    function draw(t: number) {
      for (let wi = 0; wi < WAVES.length; wi++) {
        const wv = WAVES[wi];
        for (let r = 0; r < rows; r++) {
          const b = TAU * (((r * PITCH + HALF) * wv.dy) / wv.len + t * wv.speed);
          rowSin[wi][r] = Math.sin(b);
          rowCos[wi][r] = Math.cos(b);
        }
      }
      const live = ripples
        .map((rp) => {
          const age = (t * 1000 - rp.t0) / 1000;
          const decay = Math.max(0, 1 - age / 3.2);
          return { x: rp.x, y: rp.y, ring: age * 210, gain: rp.amp * decay };
        })
        .filter((rp) => rp.gain > 0);

      const o = occ;
      ctx!.clearRect(0, 0, w, h);
      // Extrusion points up-right, so paint back (top/right) tiles first.
      for (let r = 0; r < rows; r++) {
        const y = r * PITCH;
        const py = y + HALF;
        for (let c = cols - 1; c >= 0; c--) {
          const x = c * PITCH;
          if (o && x >= o.l && x + TILE + 1.5 + MAX_DEPTH <= o.r && y - 1.5 - MAX_DEPTH >= o.t && y + TILE <= o.b) {
            continue;
          }
          let height = 0;
          for (let wi = 0; wi < WAVES.length; wi++) {
            height +=
              WAVES[wi].amp *
              (colSin[wi][c] * rowCos[wi][r] + colCos[wi][c] * rowSin[wi][r]);
          }
          const px = x + HALF;
          for (let i = 0; i < live.length; i++) {
            const rp = live[i];
            const dx = px - rp.x;
            const dy = py - rp.y;
            const dd = Math.sqrt(dx * dx + dy * dy) - rp.ring;
            if (dd > RING_REACH || dd < -RING_REACH) continue;
            height += rp.gain * Math.exp(-(dd * dd) / RING_DENOM) * Math.cos(dd / 14);
          }
          const v = Math.min(1, Math.max(0, (height + 1.4) / 2.8));
          if (v < FLOOR) continue;
          const k = (v - FLOOR) / (1 - FLOOR);
          const d = 1.5 + k * MAX_DEPTH;
          const lvl = (k * (LEVELS - 1) + 0.5) | 0;

          // top face
          ctx!.fillStyle = topFill[lvl];
          ctx!.beginPath();
          ctx!.moveTo(x, y);
          ctx!.lineTo(x + TILE, y);
          ctx!.lineTo(x + TILE + d, y - d);
          ctx!.lineTo(x + d, y - d);
          ctx!.closePath();
          ctx!.fill();

          // right face
          ctx!.fillStyle = sideFill[lvl];
          ctx!.beginPath();
          ctx!.moveTo(x + TILE, y);
          ctx!.lineTo(x + TILE + d, y - d);
          ctx!.lineTo(x + TILE + d, y + TILE - d);
          ctx!.lineTo(x + TILE, y + TILE);
          ctx!.closePath();
          ctx!.fill();

          // front face
          ctx!.fillStyle = frontFill[lvl];
          ctx!.fillRect(x, y, TILE, TILE);
        }
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (reduced || !running) return;
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
    let lastOcc = 0;
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
          if (now - lastOcc > 500) {
            lastOcc = now;
            measureOccluder();
          }
          ripples = ripples.filter((rp) => vt - rp.t0 < 3200);
          if (ripples.length < 3) spawnRandom();
          draw(vt / 1000);
        }
      } catch (err) {
        console.warn("[wave-bg] frame error", err);
      }
      if (running) raf = requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    // Only animate while the hero is on screen; also lets CSS pause hero loops.
    const io = new IntersectionObserver(([entry]) => {
      const on = entry.isIntersecting;
      document.documentElement.classList.toggle("hero-off", !on);
      if (on) start();
      else stop();
    });
    io.observe(canvas.parentElement ?? canvas);

    const onResize = () => {
      resize();
      draw(vt / 1000);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      stop();
      io.disconnect();
      document.documentElement.classList.remove("hero-off");
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
