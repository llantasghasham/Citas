import type { ReactNode } from 'react';

import { displayFont, latinOnly } from '@/lib/typography';
import type { Locale } from '@/lib/types';

interface SectionProps {
  id: string;
  locale: Locale;
  heading: string;
  subheading?: string;
  children: ReactNode;
}

/** One band of the home page: an anchor, a heading and its content. */
export function Section({ id, locale, heading, subheading, children }: SectionProps) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20 sm:px-10">
      <header className="flex max-w-2xl flex-col gap-3">
        <h2 className={`${displayFont(locale)} text-3xl text-[#F4EFE6] sm:text-4xl`}>{heading}</h2>
        {subheading === undefined ? null : (
          <p className={`${latinOnly(locale, 'tracking-[0.01em]')} text-base text-[#A79C86]`}>
            {subheading}
          </p>
        )}
      </header>

      <div className="pt-10">{children}</div>
    </section>
  );
}
