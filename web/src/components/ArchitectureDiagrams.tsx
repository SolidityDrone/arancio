"use client";

import { useEffect, useId, useRef, useState } from "react";
import { STAR_PATH } from "./Sparkles";
import {
  ARCH_DIAGRAMS,
  ISO_DEPTH as D,
  type EdgeColor,
  type IsoBlock,
  type IsoDiagramSpec,
  type IsoEdge,
  type IsoPlate,
} from "../lib/demo-architecture";

const STEP_MS = 3800;

const EDGE_STROKE: Record<EdgeColor, string> = {
  purple: "#B57BFF",
  green: "#14F195",
  magenta: "#DC1FFF",
  lime: "#C9F31D",
};

function pathD(points: [number, number][]) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

function Plate({ p }: { p: IsoPlate }) {
  const d = 10;
  const { x, y, w, h, color } = p;
  return (
    <g className="iso-plate">
      <polygon points={`${x},${y} ${x + w},${y} ${x + w + d},${y - d} ${x + d},${y - d}`} fill={color} fillOpacity={0.1} />
      <polygon points={`${x + w},${y} ${x + w + d},${y - d} ${x + w + d},${y + h - d} ${x + w},${y + h}`} fill={color} fillOpacity={0.06} />
      <rect x={x} y={y} width={w} height={h} fill={color} fillOpacity={0.045} stroke={color} strokeOpacity={0.38} />
      <rect x={x + 14} y={y + 12} width={p.label.length * 8.2 + 18} height={20} rx={10} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.55} />
      <text x={x + 23} y={y + 26} className="iso-plate-label" fill={color}>
        {p.label}
      </text>
    </g>
  );
}

function Block({
  b,
  uid,
  state,
  index,
}: {
  b: IsoBlock;
  uid: string;
  state: "on" | "off";
  index: number;
}) {
  const { x, y, w, h } = b;
  const logoSize = Math.min(40, h - 26);
  const tx = b.logo ? x + 14 + logoSize + 12 : x + 16;
  const ty = y + h / 2;
  return (
    <g className={`iso-block is-${state}`} style={{ "--i": index } as React.CSSProperties}>
      <g className="iso-block-enter">
      {state === "on" ? (
        <rect x={x} y={y} width={w} height={h} className="iso-ping" fill="none" stroke="#14F195" />
      ) : null}
      <g className="iso-block-lift">
        <polygon points={`${x},${y} ${x + w},${y} ${x + w + D},${y - D} ${x + D},${y - D}`} fill="#2E2358" />
        <polygon points={`${x + w},${y} ${x + w + D},${y - D} ${x + w + D},${y + h - D} ${x + w},${y + h}`} fill="#0D0A1B" />
        <rect x={x} y={y} width={w} height={h} fill={`url(#${uid}-face)`} />
        <polygon
          points={`${x},${y} ${x + w},${y} ${x + w + D},${y - D} ${x + D},${y - D}`}
          fill="none"
          stroke={`url(#${uid}-sol)`}
          strokeOpacity={0.75}
        />
        <rect x={x} y={y} width={w} height={h} fill="none" stroke={`url(#${uid}-sol)`} strokeWidth={1.3} className="iso-block-rim" />
        {b.logo ? (
          <image href={b.logo} x={x + 14} y={y + (h - logoSize) / 2} width={logoSize} height={logoSize} />
        ) : null}
        <text x={tx} y={ty - 3} className="iso-block-title">
          {b.title}
        </text>
        <text x={tx} y={ty + 15} className="iso-block-sub">
          {b.sub}
        </text>
        {state === "on" ? (
          <g transform={`translate(${x + w + D - 9},${y - D - 9})`}>
            <path d={STAR_PATH} className="iso-glint" transform="scale(0.75)" />
          </g>
        ) : null}
      </g>
      </g>
    </g>
  );
}

function Edge({
  e,
  uid,
  active,
  index,
  live,
}: {
  e: IsoEdge;
  uid: string;
  active: boolean;
  index: number;
  /** Board on screen — SMIL packets only run while visible. */
  live: boolean;
}) {
  const stroke = EDGE_STROKE[e.color];
  const d = pathD(e.points);
  const pid = `${uid}-p-${e.id}`;
  const w = e.label ? e.label.text.length * 6.4 + 18 : 0;
  return (
    <g
      className={`iso-edge ${active ? "is-on" : "is-off"}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <path
        id={pid}
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeDasharray={e.dashed ? "6 5" : undefined}
        markerEnd={e.noHead ? undefined : `url(#${uid}-ah-${e.color})`}
        className="iso-edge-base"
      />
      <path d={d} fill="none" stroke={stroke} strokeWidth={active ? 3 : 2} className="iso-edge-flow" />
      {active ? (
        <>
          {!e.noHead && live ? (
            <circle r={4} fill={stroke} className="iso-packet">
              <animateMotion dur="1.5s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${pid}`} />
              </animateMotion>
            </circle>
          ) : null}
        </>
      ) : null}
      {e.label ? (
        <g className="iso-pill">
          <rect x={e.label.x - w / 2} y={e.label.y - 10} width={w} height={20} rx={10} fill="#0B0915" stroke={stroke} strokeOpacity={0.65} />
          <text x={e.label.x} y={e.label.y + 4} textAnchor="middle" className="iso-pill-text">
            {e.label.text}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function IsoBoard({ spec }: { spec: IsoDiagramSpec }) {
  const uid = `iso-${spec.id}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setEntered(true);
    }, {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !visible) return;
    const id = window.setTimeout(
      () => setActive((i) => (i + 1) % spec.steps.length),
      STEP_MS
    );
    return () => window.clearTimeout(id);
  }, [active, paused, visible, spec.steps.length]);

  const step = spec.steps[active];
  const litBlocks = new Set(step.blocks);
  const litEdges = new Set(step.edges);

  return (
    <article
      ref={rootRef}
      className={`iso-board${entered ? " is-entered" : ""}${visible ? "" : " is-paused"}`}
      id={`arch-${spec.id}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <header className="iso-board-head">
        <p className="iso-eyebrow mono">{spec.eyebrow}</p>
        <h3>{spec.title}</h3>
        <p className="iso-lead">{spec.lead}</p>
      </header>

      <div className="iso-stage">
        <svg
          viewBox={`0 0 ${spec.width} ${spec.height}`}
          className="iso-svg"
          role="img"
          aria-label={spec.title}
        >
          <defs>
            <linearGradient id={`${uid}-sol`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#9945FF" />
              <stop offset="1" stopColor="#14F195" />
            </linearGradient>
            <linearGradient id={`${uid}-face`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1D1638" />
              <stop offset="1" stopColor="#110D22" />
            </linearGradient>
            {(Object.keys(EDGE_STROKE) as EdgeColor[]).map((c) => (
              <marker
                key={c}
                id={`${uid}-ah-${c}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={EDGE_STROKE[c]} />
              </marker>
            ))}
          </defs>

          {spec.plates.map((p) => (
            <Plate key={p.label} p={p} />
          ))}
          {spec.edges.map((e, i) => (
            <Edge key={e.id} e={e} uid={uid} active={litEdges.has(e.id)} index={i} live={visible} />
          ))}
          {spec.blocks.map((b, i) => (
            <Block
              key={b.id}
              b={b}
              uid={uid}
              index={i}
              state={litBlocks.has(b.id) ? "on" : "off"}
            />
          ))}
          <text x={40} y={spec.footer.y} className="iso-footer">
            {spec.footer.text}
          </text>
        </svg>
      </div>

      <div className="iso-controls">
        <ol className="iso-steps">
          {spec.steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={i === active ? "iso-step is-on" : "iso-step"}
                aria-current={i === active ? "step" : undefined}
                onClick={() => setActive(i)}
              >
                <span className="iso-step-t mono">{s.t}</span>
                <span className="iso-step-title">{s.title}</span>
                {i === active ? (
                  <span
                    key={`${active}-${paused}-${visible}`}
                    className={`iso-step-bar${paused || !visible ? " is-paused" : ""}`}
                    style={{ animationDuration: `${STEP_MS}ms` }}
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ol>
        <div className="iso-story" aria-live="polite">
          <p className="iso-story-t mono">
            {step.t} · {active + 1}/{spec.steps.length}
            {paused ? " · paused" : ""}
          </p>
          <h4>{step.title}</h4>
          <p>{step.body}</p>
        </div>
      </div>
    </article>
  );
}

export function ArchitectureDiagrams() {
  return (
    <div className="iso-boards">
      {ARCH_DIAGRAMS.map((spec) => (
        <IsoBoard key={spec.id} spec={spec} />
      ))}
    </div>
  );
}
