"use client";

import { useId, useState } from "react";
import {
  CURVE_NODES,
  CURVE_STEPS,
  CURVE_SUMMARY,
  SPLIT_NODES,
  SPLIT_STEPS,
  SPLIT_SUMMARY,
  type ArchNode,
  type ArchStep,
} from "../lib/demo-architecture";

function nodeMap(nodes: ArchNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

function FlowRail({
  steps,
  active,
  onSelect,
}: {
  steps: ArchStep[];
  active: number;
  onSelect: (i: number) => void;
}) {
  const beamId = useId().replace(/:/g, "");

  return (
    <div className="arch-flow" role="list" aria-label="Timeline">
      <div className="arch-flow-track" aria-hidden>
        <svg className="arch-flow-beam" preserveAspectRatio="none">
          <defs>
            <linearGradient id={beamId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(20,241,149,0.2)" />
              <stop offset="55%" stopColor="rgba(20,241,149,0.65)" />
              <stop offset="100%" stopColor="rgba(0,209,255,0.4)" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1="50%"
            x2="100%"
            y2="50%"
            stroke={`url(#${beamId})`}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <ol className="arch-flow-steps">
        {steps.map((s, i) => {
          const on = i === active;
          return (
            <li key={s.id} role="listitem" className="arch-flow-item">
              <button
                type="button"
                className={on ? "arch-flow-btn is-on" : "arch-flow-btn"}
                onClick={() => onSelect(i)}
                aria-current={on ? "step" : undefined}
              >
                <span className="arch-flow-dot" aria-hidden />
                <span className="arch-flow-t mono">{s.t}</span>
                <span className="arch-flow-title">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ContractGraph({
  nodes,
  lit,
}: {
  nodes: ArchNode[];
  lit: Set<string>;
}) {
  return (
    <div className="arch-graph" aria-label="Contracts in this step">
      {nodes.map((n) => (
        <div
          key={n.id}
          className={
            lit.has(n.id)
              ? `arch-chip arch-chip-${n.kind} is-lit`
              : `arch-chip arch-chip-${n.kind}`
          }
        >
          <span className="arch-chip-kind">{n.kind}</span>
          <strong>{n.label}</strong>
          <span>{n.detail}</span>
        </div>
      ))}
    </div>
  );
}

function ArchBoard({
  id,
  eyebrow,
  title,
  lead,
  steps,
  nodes,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  steps: ArchStep[];
  nodes: ArchNode[];
}) {
  const [active, setActive] = useState(0);
  const step = steps[active] ?? steps[0];
  const lit = new Set(step.nodes);
  const byId = nodeMap(nodes);

  return (
    <article className="arch-board" id={id}>
      <header className="arch-board-head">
        <p className="arch-board-eyebrow mono">{eyebrow}</p>
        <h3>{title}</h3>
        <p className="arch-board-lead">{lead}</p>
      </header>

      <div className="arch-board-flow">
        <FlowRail steps={steps} active={active} onSelect={setActive} />
      </div>

      <div className="arch-board-body">
        <div className="arch-board-story">
          <p className="mono arch-board-step">{step.t}</p>
          <h4>{step.title}</h4>
          <p>{step.body}</p>
          <ul className="arch-board-hits">
            {step.nodes.map((nid) => {
              const n = byId.get(nid);
              if (!n) return null;
              return (
                <li key={nid}>
                  <code>{n.label}</code>
                </li>
              );
            })}
          </ul>
          <div className="arch-board-nav">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={active === 0}
              onClick={() => setActive((i) => Math.max(0, i - 1))}
            >
              ← Prev
            </button>
            <span className="arch-board-count mono">
              {active + 1} / {steps.length}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={active >= steps.length - 1}
              onClick={() =>
                setActive((i) => Math.min(steps.length - 1, i + 1))
              }
            >
              Next →
            </button>
          </div>
        </div>
        <ContractGraph nodes={nodes} lit={lit} />
      </div>
    </article>
  );
}

export function ArchitectureDiagrams() {
  return (
    <div className="arch-diagrams">
      <ArchBoard
        id="arch-split"
        eyebrow="Diagram 01 · On-chain split"
        title="From CRE to PT / YT redeem"
        lead={SPLIT_SUMMARY}
        steps={SPLIT_STEPS}
        nodes={SPLIT_NODES}
      />
      <ArchBoard
        id="arch-curve"
        eyebrow="Diagram 02 · Curve market"
        title="DBC · vault · graduation · Kamino park"
        lead={CURVE_SUMMARY}
        steps={CURVE_STEPS}
        nodes={CURVE_NODES}
      />
    </div>
  );
}
