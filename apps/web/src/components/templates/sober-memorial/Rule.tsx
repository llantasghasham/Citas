/** A plain centred rule. The only separator this template allows itself. */
export function Rule({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 2" aria-hidden="true" focusable="false">
      <path d="M0 1 H200" stroke="currentColor" strokeWidth={1.4} opacity={0.6} />
    </svg>
  );
}
