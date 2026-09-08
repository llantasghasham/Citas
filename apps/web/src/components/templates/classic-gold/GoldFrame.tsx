import { GoldCorner } from './GoldCorner';

const WIDTH = 1080;
const HEIGHT = 1920;

/**
 * Decorative double rule plus the four floral corners. Lives in the card's own
 * SVG coordinate space (1080×1920, the export size), so it scales with the card
 * and never depends on physical CSS sides.
 */
export function GoldFrame({ label }: { label: string }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full text-[color:var(--inv-accent)]"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <rect
        x={44}
        y={44}
        width={WIDTH - 88}
        height={HEIGHT - 88}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        opacity={0.75}
      />
      <rect
        x={60}
        y={60}
        width={WIDTH - 120}
        height={HEIGHT - 120}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.9}
        opacity={0.45}
      />

      <GoldCorner />
      <g transform={`translate(${WIDTH} 0) scale(-1 1)`}>
        <GoldCorner />
      </g>
      <g transform={`translate(0 ${HEIGHT}) scale(1 -1)`}>
        <GoldCorner />
      </g>
      <g transform={`translate(${WIDTH} ${HEIGHT}) scale(-1 -1)`}>
        <GoldCorner />
      </g>
    </svg>
  );
}
