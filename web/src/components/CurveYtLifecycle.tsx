import { Link } from "react-router-dom";
import {
  CURVE_YT_LIFECYCLE,
  LIFECYCLE_SUMMARY,
  type LifecyclePhase,
} from "../lib/curve-yt-lifecycle";
import { CURVE_YT_CALLOUT, STRIP_YT_CALLOUT } from "../lib/curve-yt-labels";

type Props = {
  variant?: "full" | "compact";
  showDeskLink?: boolean;
};

function PhaseCard({ phase }: { phase: LifecyclePhase }) {
  return (
    <article
      className={`lifecycle-phase lifecycle-phase-${phase.status}`}
      id={`lifecycle-${phase.id}`}
    >
      <header className="lifecycle-phase-head">
        <span className="lifecycle-step">{phase.step}</span>
        <div>
          <h3>{phase.title}</h3>
          <p className="lifecycle-venue mono">{phase.venue}</p>
        </div>
        <span
          className={`lifecycle-badge lifecycle-badge-${phase.status}`}
        >
          {phase.status === "live" ? "Live" : "Roadmap"}
        </span>
      </header>
      <p className="lifecycle-pair mono">{phase.pair}</p>
      <p className="lifecycle-body">{phase.body}</p>
    </article>
  );
}

export function CurveYtLifecycle({
  variant = "full",
  showDeskLink = false,
}: Props) {
  if (variant === "compact") {
    return (
      <div className="lifecycle-compact">
        <p className="lifecycle-compact-lead">{LIFECYCLE_SUMMARY}</p>
        <ol className="lifecycle-compact-steps">
          {CURVE_YT_LIFECYCLE.map((p) => (
            <li key={p.id}>
              <span className="lifecycle-compact-step">{p.step}</span>
              <span className="mono">{p.pair}</span>
              <span className={`lifecycle-badge lifecycle-badge-${p.status}`}>
                {p.status === "live" ? "Live" : "Soon"}
              </span>
            </li>
          ))}
        </ol>
        <p className="hint lifecycle-token-note">
          <strong>curve-YT</strong> — {CURVE_YT_CALLOUT}{" "}
          <strong>strip YT</strong> — {STRIP_YT_CALLOUT}
        </p>
        {showDeskLink ? (
          <Link to="/app" className="dashboard-row-link lifecycle-desk-link">
            Open strip desk ↗
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="lifecycle-full">
      <p className="lead lifecycle-lead">{LIFECYCLE_SUMMARY}</p>
      <div className="lifecycle-token-legend">
        <div>
          <span className="curve-yt-tag">curve-YT</span>
          <p>{CURVE_YT_CALLOUT}</p>
        </div>
        <div>
          <span className="lifecycle-strip-tag">strip YT</span>
          <p>{STRIP_YT_CALLOUT}</p>
        </div>
      </div>
      <div className="lifecycle-grid">
        {CURVE_YT_LIFECYCLE.map((p) => (
          <PhaseCard key={p.id} phase={p} />
        ))}
      </div>
      {showDeskLink ? (
        <div className="lifecycle-cta">
          <Link to="/app" className="btn btn-primary">
            Try phase 1 on the desk →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
