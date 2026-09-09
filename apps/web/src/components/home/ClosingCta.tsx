import type { ResolvedSite } from '@/lib/home/site';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

/** The last ask, for a reader who scrolled the whole way down. */
export function ClosingCta({ dictionary, locale, site }: { dictionary: Dictionary; locale: Locale; site: ResolvedSite }) {
  const copy = dictionary.home.closing;

  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-[#3A3122] bg-[#1A1712] px-8 py-16 text-center">
        <h2 className={`${displayFont(locale)} text-3xl text-[#F4EFE6] sm:text-4xl`}>
          {copy.heading}
        </h2>
        <p className="max-w-xl text-base text-[#A79C86]">{copy.body}</p>
        <a
          href={site.routes.create}
          className="rounded-full bg-[#C9A227] px-7 py-3.5 text-base font-medium text-[#14120E] transition-opacity hover:opacity-90"
        >
          {copy.cta}
        </a>
      </div>
    </section>
  );
}
