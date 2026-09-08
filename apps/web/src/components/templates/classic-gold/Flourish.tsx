/** Horizontal separator ornament. Mirror-symmetric, so RTL-safe by construction. */
export function Flourish({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 40"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 20 H118" strokeWidth={1.1} opacity={0.5} />
      <path d="M202 20 H312" strokeWidth={1.1} opacity={0.5} />
      <path d="M118 20 C 134 20 138 8 152 8 C 158 8 160 14 160 20" strokeWidth={1.4} opacity={0.8} />
      <path d="M202 20 C 186 20 182 32 168 32 C 162 32 160 26 160 20" strokeWidth={1.4} opacity={0.8} />
      <g fill="currentColor" stroke="none">
        <path d="M160 8 L168 20 L160 32 L152 20 Z" opacity={0.85} />
        <circle cx={118} cy={20} r={2.4} opacity={0.7} />
        <circle cx={202} cy={20} r={2.4} opacity={0.7} />
      </g>
    </svg>
  );
}
