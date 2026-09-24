"use client";

import { useEffect } from "react";
import { STAR_PATH } from "./Sparkles";

/** Cards that get a cursor-follow spotlight (reads --mx / --my). */
const SPOT =
  ".flow-step,.usecase,.oracle-card,.oracle-compare-col,.lifecycle-phase,.dashboard-schedule-card,.desk-center .desk-card,.iso-board,.hero-stage-frame,.iso-step";

/** Landing / dashboard pieces that slide in on first scroll into view. */
const REVEAL =
  ".section-rail,.flow-step,.usecase,.oracle-card,.oracle-compare-col,.lifecycle-phase,.lifecycle-token-legend > div,.dashboard-schedule-card";

/**
 * Global eye candy: spotlight, scroll reveal, hero tilt, button ripples.
 * Purely decorative — everything degrades to static if JS or motion is off.
 */
export function FxLayer() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("fx-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          en.target.classList.add("fx-in");
          io.unobserve(en.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    const seen = new WeakSet<Element>();
    let scanQueued = false;
    const scan = () => {
      scanQueued = false;
      document.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        if (seen.has(el) || el.classList.contains("fx-in")) return;
        seen.add(el);
        if (reduced) {
          el.classList.add("fx-in");
          return;
        }
        const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
        el.style.setProperty("--fx-i", String(Math.max(0, siblings.indexOf(el)) % 6));
        io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(() => {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    let pending: PointerEvent | null = null;
    let moveQueued = false;
    const onMove = (e: PointerEvent) => {
      pending = e;
      if (moveQueued) return;
      moveQueued = true;
      requestAnimationFrame(() => {
        moveQueued = false;
        if (pending) applyMove(pending);
      });
    };

    const applyMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const card = target?.closest?.(SPOT) as HTMLElement | null;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
      if (reduced) return;
      const stage = target?.closest?.(".hero-stage") as HTMLElement | null;
      const frame = document.querySelector<HTMLElement>(".hero-stage-frame");
      if (!frame) return;
      if (stage) {
        const r = stage.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        frame.style.setProperty("--ry", `${(px * 7).toFixed(2)}deg`);
        frame.style.setProperty("--rx", `${(-py * 6).toFixed(2)}deg`);
      } else {
        frame.style.setProperty("--ry", "0deg");
        frame.style.setProperty("--rx", "0deg");
      }
    };

    const onDown = (e: PointerEvent) => {
      if (reduced) return;
      const btn = (e.target as Element | null)?.closest?.(".btn, .iso-step") as HTMLElement | null;
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const r = btn.getBoundingClientRect();
      const dot = document.createElement("span");
      dot.className = "fx-ripple";
      dot.style.left = `${e.clientX - r.left}px`;
      dot.style.top = `${e.clientY - r.top}px`;
      btn.appendChild(dot);
      window.setTimeout(() => dot.remove(), 650);
    };

    // Sparkle layer: cursor trail + click bursts (DOM nodes, capped).
    const layer = document.createElement("div");
    layer.className = "fx-spark-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    const SPARK_COLORS = ["#ffffff", "#14F195", "#C9A8FF", "#9945FF", "#DC1FFF"];
    const MAX_SPARKS = 48;
    const svgNs = "http://www.w3.org/2000/svg";
    const spark = (x: number, y: number, dx: number, dy: number, size: number, cls: string) => {
      if (layer.childElementCount >= MAX_SPARKS) layer.firstElementChild?.remove();
      const s = document.createElementNS(svgNs, "svg");
      s.setAttribute("viewBox", "0 0 24 24");
      s.setAttribute("class", `fx-spark ${cls}`);
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", STAR_PATH);
      path.setAttribute("fill", "currentColor");
      s.appendChild(path);
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      s.style.setProperty("--dx", `${dx}px`);
      s.style.setProperty("--dy", `${dy}px`);
      s.style.setProperty("--s", `${size}px`);
      s.style.setProperty("--rot", `${Math.round(Math.random() * 180)}deg`);
      s.style.color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      s.addEventListener("animationend", () => s.remove(), { once: true });
      layer.appendChild(s);
    };

    let lastTrail = { x: -999, y: -999 };
    const onTrail = (e: PointerEvent) => {
      if (reduced || e.pointerType === "touch") return;
      const dist = Math.hypot(e.clientX - lastTrail.x, e.clientY - lastTrail.y);
      if (dist < 26) return;
      lastTrail = { x: e.clientX, y: e.clientY };
      spark(
        e.clientX + (Math.random() - 0.5) * 10,
        e.clientY + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 24,
        12 + Math.random() * 18,
        6 + Math.random() * 7,
        "fx-spark-trail"
      );
    };

    const onBurst = (e: PointerEvent) => {
      if (reduced) return;
      const hit = (e.target as Element | null)?.closest?.(
        ".btn, .iso-step, .nav-rail-link, .wallet-adapter-button, .brand"
      );
      if (!hit) return;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const r = 34 + Math.random() * 30;
        spark(e.clientX, e.clientY, Math.cos(ang) * r, Math.sin(ang) * r, 7 + Math.random() * 8, "fx-spark-burst");
      }
    };

    window.addEventListener("pointermove", onTrail, { passive: true });
    window.addEventListener("pointerdown", onBurst);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown);
    return () => {
      io.disconnect();
      mo.disconnect();
      layer.remove();
      window.removeEventListener("pointermove", onTrail);
      window.removeEventListener("pointerdown", onBurst);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      root.classList.remove("fx-ready");
    };
  }, []);

  return null;
}
