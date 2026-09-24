"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { ClientWalletButton } from "./ClientWalletButton";

const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/", label: "Overview", match: (p) => p === "/" },
  { href: "/app", label: "Strip desk", match: (p) => p.startsWith("/app") },
  { href: "/dashboard", label: "Dashboard", match: (p) => p.startsWith("/dashboard") },
];

function BrandMark() {
  // Extruded cube split along the diagonal: PT half (purple) + YT half (green).
  return (
    <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden>
      <g className="brand-mark-pt">
        <polygon points="6,12 20,12 6,26" fill="#9945FF" />
        <polygon points="6,12 10,8 24,8 20,12" fill="#B57BFF" />
      </g>
      <g className="brand-mark-yt">
        <polygon points="20,12 20,26 6,26" fill="#14F195" />
        <polygon points="20,12 24,8 24,22 20,26" fill="#0B9F63" />
      </g>
    </svg>
  );
}

function ChainChip() {
  const { connection } = useConnection();
  const [slot, setSlot] = useState<number | null>(null);
  const [down, setDown] = useState(false);
  const endpoint = connection.rpcEndpoint;
  const local = /127\.0\.0\.1|localhost/.test(endpoint);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const s = await connection.getSlot("confirmed");
        if (!alive) return;
        setSlot(s);
        setDown(false);
      } catch {
        if (alive) setDown(true);
      }
    };
    void tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [connection]);

  return (
    <div className={`nav-chip${down ? " is-down" : ""}`} title={endpoint}>
      <i className="nav-chip-dot" aria-hidden />
      <span className="nav-chip-net">{local ? "Surfpool" : "Mainnet"}</span>
      <span className="nav-chip-slot mono" key={slot ?? "none"}>
        {down ? "offline" : slot != null ? `slot ${slot.toLocaleString()}` : "…"}
      </span>
    </div>
  );
}

function NavRail() {
  const pathname = usePathname();
  const railRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const activeIdx = LINKS.findIndex((l) => l.match(pathname));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  const measure = useCallback(() => {
    const idx = hoverIdx ?? activeIdx;
    const el = idx >= 0 ? linkRefs.current[idx] : null;
    setBox(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  }, [hoverIdx, activeIdx]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <nav className="nav-rail" ref={railRef} onMouseLeave={() => setHoverIdx(null)}>
      <span
        className={`nav-rail-indicator${box ? " is-on" : ""}${hoverIdx != null && hoverIdx !== activeIdx ? " is-hover" : ""}`}
        style={box ? { transform: `translateX(${box.x}px)`, width: box.w } : undefined}
        aria-hidden
      />
      {LINKS.map((l, i) => (
        <Link
          key={l.href}
          href={l.href}
          ref={(el) => {
            linkRefs.current[i] = el;
          }}
          className={`nav-rail-link${i === activeIdx ? " active" : ""}`}
          data-active={i === activeIdx}
          onMouseEnter={() => setHoverIdx(i)}
          onFocus={() => setHoverIdx(i)}
          onBlur={() => setHoverIdx(null)}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function Nav() {
  const headerRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      headerRef.current?.style.setProperty("--scroll", pct.toFixed(4));
      setScrolled(window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <header ref={headerRef} className={`nav${scrolled ? " is-scrolled" : ""}`}>
      <div className="nav-bar">
        <Link href="/" className="brand" aria-label="DivStrip home">
          <BrandMark />
          <span className="brand-word">
            DivStrip<span className="brand-cursor">_</span>
          </span>
        </Link>
        <NavRail />
        <div className="nav-right">
          <ChainChip />
          <ClientWalletButton />
        </div>
      </div>
      <span className="nav-progress" aria-hidden />
    </header>
  );
}
