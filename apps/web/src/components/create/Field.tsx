import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export const FIELD_CLASS =
  'w-full border border-[#cdc6b6] bg-white px-4 py-3 text-base text-[#23201a] outline-none focus-visible:border-[#8a6c22] focus-visible:ring-2 focus-visible:ring-[#c9a227]';

/** Label, control and hint as one block, so every field looks the same. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-2 text-sm text-[#23201a]">
      <span>
        {label}
        {hint === undefined ? null : <span className="opacity-60"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}
