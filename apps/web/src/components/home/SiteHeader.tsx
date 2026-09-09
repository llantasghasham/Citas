import { SITE, shows } from '@/config/site';
import { localeHref } from '@/lib/home/locale';
import { LOCALE_NAMES } from '@/lib/create/options';
import { displayFont, latinOnly } from '@/lib/typography';
import { LOCALES, type Dictionary, type Locale } from '@/lib/types';

/**
 * The bar at the top: the name, the anchors of the blocks that are switched on,
 * the language, and the two ways in — signing in and creating.
 */
export function SiteHeader({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const nav = dictionary.home.nav;
  const links = [
    { href: '#features', label: nav.features, visible: shows('features') },
    { href: '#steps', label: nav.how, visible: shows('steps') },
    { href: '#showcase', label: nav.templates, visible: shows('showcase') },
    { href: '#pricing', label: nav.pricing, visible: shows('pricing') },
    { href: '#faq', label: nav.faq, visible: shows('faq') },
  ].filter((link) => link.visible);

  return (
    <header className="sticky top-0 z-20 border-b border-[#2A2419] bg-[#14120E]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-4 px-6 py-4 sm:px-10">
        <a href="#top" className={`${displayFont(locale)} text-xl text-[#F4EFE6]`}>
          {SITE.brand}
        </a>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#A79C86]">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-[#F4EFE6]">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 ms-auto">
          <LanguagePicker current={locale} />

          <a href={SITE.routes.signIn} className="text-sm text-[#A79C86] hover:text-[#F4EFE6]">
            {nav.signIn}
          </a>
          <a
            href={SITE.routes.create}
            className={`${latinOnly(locale, 'tracking-[0.02em]')} rounded-full bg-[#C9A227] px-5 py-2.5 text-sm font-medium text-[#14120E] transition-opacity hover:opacity-90`}
          >
            {nav.cta}
          </a>
        </div>
      </div>
    </header>
  );
}

/**
 * Four links, no JavaScript. Each one reloads the page in that language, so the
 * URL a visitor copies is the language they were reading.
 */
function LanguagePicker({ current }: { current: Locale }) {
  return (
    <ul className="flex items-center gap-x-3 text-xs">
      {LOCALES.map((locale) => (
        <li key={locale}>
          <a
            href={localeHref(locale)}
            hrefLang={locale}
            lang={locale}
            aria-current={locale === current ? 'true' : undefined}
            className={
              locale === current
                ? 'text-[#E4C76B] underline underline-offset-4'
                : 'text-[#786F5D] hover:text-[#F4EFE6]'
            }
          >
            {LOCALE_NAMES[locale]}
          </a>
        </li>
      ))}
    </ul>
  );
}
