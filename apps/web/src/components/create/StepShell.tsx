import type { ReactNode } from 'react';

import { saveStepAction } from '@/app/crear/actions';
import { interpolate } from '@/lib/dictionary';
import { latinOnly } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

interface StepShellProps {
  step: number;
  total: number;
  title: string;
  dictionary: Dictionary;
  /** The invitation's language, which decides whether Latin typography applies. */
  locale: Locale;
  children: ReactNode;
}

const BUTTON =
  'bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6c22]';
const GHOST =
  'border border-[#23201a] px-6 py-3 text-base text-[#23201a] transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a6c22]';

/** One step of the form: heading, fields, and the two ways out of it. */
export function StepShell({ step, total, title, dictionary, locale, children }: StepShellProps) {
  const copy = dictionary.create;

  return (
    <form action={saveStepAction} className="flex flex-col gap-6">
      <input type="hidden" name="step" value={step} />

      <header className="flex flex-col gap-1">
        <p className={`text-xs ${latinOnly(locale, 'uppercase tracking-[0.16em]')} text-[#8a6c22]`}>
          {interpolate(copy.stepOf, { step: String(step), total: String(total) })}
        </p>
        <h2 className="text-2xl text-[#23201a]">{title}</h2>
      </header>

      {children}

      <div className="flex flex-wrap gap-3">
        <button type="submit" name="direction" value="next" className={BUTTON}>
          {copy.next}
        </button>
        {step > 1 ? (
          <button type="submit" name="direction" value="back" formNoValidate className={GHOST}>
            {copy.back}
          </button>
        ) : null}
      </div>
    </form>
  );
}
