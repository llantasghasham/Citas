/** A slim almond leaf drawn along +x, reused along the vine. */
function Leaf({ x, y, angle, scale = 1 }: { x: number; y: number; angle: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path
        d="M0 0 C 11 -8 24 -7 32 3 C 21 12 7 11 0 0 Z"
        fill="currentColor"
        stroke="none"
        opacity={0.42}
      />
      <path d="M2 1 C 12 2 23 3 30 3" strokeWidth={0.9} opacity={0.55} />
    </g>
  );
}

/**
 * One floral corner of the classic-gold frame, drawn in a 260×260 area at the
 * origin of the frame's coordinate system. Rendered four times by GoldFrame
 * with SVG transforms, so the artwork is mirror-symmetric and looks identical
 * in RTL and LTR without any CSS direction logic.
 */
export function GoldCorner() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round">
      {/* Two staggered sweeps hugging the corner. */}
      <path d="M52 244 C 56 150 116 72 244 52" strokeWidth={2.4} opacity={0.85} />
      <path d="M76 238 C 82 168 134 102 216 80" strokeWidth={1} opacity={0.5} />

      {/* Leaves on the inner side of the vine, radiating towards the card. */}
      <Leaf x={88} y={176} angle={18} />
      <Leaf x={118} y={124} angle={44} scale={0.92} />
      <Leaf x={172} y={88} angle={70} scale={0.8} />

      {/* Curled tips. */}
      <path d="M244 52 C 256 50 261 58 255 64 C 251 67 246 65 246 60" strokeWidth={1.4} opacity={0.7} />
      <path d="M52 244 C 50 256 58 261 64 255 C 67 251 65 246 60 246" strokeWidth={1.4} opacity={0.7} />

      <g stroke="none" fill="currentColor">
        <circle cx={62} cy={206} r={2.8} opacity={0.6} />
        <circle cx={206} cy={62} r={2.8} opacity={0.6} />
      </g>

      {/* Small rosette tucked into the deep corner. */}
      <g transform="translate(84 84)" stroke="none" fill="currentColor" opacity={0.45}>
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <ellipse key={angle} cx={0} cy={-8} rx={3.6} ry={8} transform={`rotate(${angle})`} />
        ))}
        <circle cx={0} cy={0} r={2.8} opacity={0.9} />
      </g>
    </g>
  );
}
