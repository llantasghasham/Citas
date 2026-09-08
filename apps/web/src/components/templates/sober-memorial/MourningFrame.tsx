const WIDTH = 1080;
const HEIGHT = 1920;

/**
 * A single hairline border and nothing else.
 *
 * Mourning cards across the Lebanese communities share the same restraint: a
 * plain bordered card, no ornament. The absence of a motif is the design.
 */
export function MourningFrame({ label }: { label: string }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full text-[color:var(--inv-accent)]"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <rect
        x={54}
        y={54}
        width={WIDTH - 108}
        height={HEIGHT - 108}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.55}
      />
    </svg>
  );
}
