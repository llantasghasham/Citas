/** Small diamond used between honoree names — a glyph-free, language-neutral join. */
export function NameSeparator({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M20 6 L28 20 L20 34 L12 20 Z" fill="currentColor" opacity={0.75} />
      <path d="M4 20 H10 M30 20 H36" stroke="currentColor" strokeWidth={1.2} opacity={0.5} />
    </svg>
  );
}
