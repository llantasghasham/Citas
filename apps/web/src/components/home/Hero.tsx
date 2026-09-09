import { SITE } from '@/config/site';
import { displayFont, latinOnly } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

/**
 * The first screen. One promise, two ways to act on it, and the three things
 * this platform is actually different about.
 */
export function Hero({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const copy = dictionary.home.hero;
  const proofs = [copy.proof.languages, copy.proof.noApp, copy.proof.whatsapp];

  return (
    <div id="top" className="relative overflow-hidden">
      {/* A single warm glow behind the headline. Decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[-18rem] mx-auto h-[36rem] max-w-3xl rounded-full bg-[#C9A227] opacity-[0.13] blur-[120px]"
      />

      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-24 text-center sm:px-10 sm:py-28">
        <p
          className={`${latinOnly(locale, 'tracking-[0.06em]')} rounded-full border border-[#4A3F26] bg-[#1D1A14] px-4 py-1.5 text-xs text-[#E4C76B]`}
        >
          {copy.badge}
        </p>

        <h1
          className={`${displayFont(locale)} text-4xl leading-[1.15] text-[#F4EFE6] sm:text-6xl`}
        >
          {copy.titleLead} <span className="text-[#E4C76B]">{copy.titleHighlight}</span>
        </h1>

        <p className="max-w-2xl text-lg leading-relaxed text-[#A79C86]">{copy.subtitle}</p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href={SITE.routes.create}
            className="rounded-full bg-[#C9A227] px-7 py-3.5 text-base font-medium text-[#14120E] transition-opacity hover:opacity-90"
          >
            {copy.ctaPrimary}
          </a>
          <a
            href={SITE.routes.examples}
            className="rounded-full border border-[#4A3F26] px-7 py-3.5 text-base text-[#F4EFE6] transition-colors hover:border-[#C9A227]"
          >
            {copy.ctaSecondary}
          </a>
        </div>

        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-[#A79C86]">
          {proofs.map((proof) => (
            <li key={proof} className="flex items-center gap-2">
              <span aria-hidden="true" className="text-[#C9A227]">
                ✓
              </span>
              {proof}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
