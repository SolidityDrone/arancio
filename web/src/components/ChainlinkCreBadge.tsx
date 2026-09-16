type Props = {
  className?: string;
  /** Hero placement — larger inline treatment. */
  variant?: "default" | "hero";
};

function ChainlinkMark() {
  return (
    <span className="chainlink-mark-wrap">
      <svg
        className="chainlink-mark-svg"
        viewBox="-2 -2 42 42"
        aria-hidden
        focusable="false"
      >
        <path
          fill="#375BD2"
          d="M18.9 0l-4 2.3L4 8.6l-4 2.3V32.7L4 35l11 6.3 4 2.3 4-2.3L33.8 35l4-2.3V10.9l-4-2.3-10.9-6.3-4-2.3zM8 28.1V15.5l10.9-6.3 10.9 6.3v12.6l-10.9 6.3L8 28.1z"
        />
      </svg>
    </span>
  );
}

export function ChainlinkCreBadge({
  className = "",
  variant = "default",
}: Props) {
  const isHero = variant === "hero";

  return (
    <div
      className={`chainlink-cre-badge ${isHero ? "chainlink-cre-badge-hero" : ""} ${className}`.trim()}
    >
      <span className="chainlink-powered-by">Powered by</span>
      <ChainlinkMark />
      <span className="chainlink-powered-brand">
        Chainlink <strong>CRE</strong>
      </span>
    </div>
  );
}
