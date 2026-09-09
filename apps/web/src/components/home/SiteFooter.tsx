import type { ResolvedSite } from '@/lib/home/site';
import { LOCALE_NAMES } from '@/lib/create/options';
import { localeHref } from '@/lib/home/locale';
import { displayFont } from '@/lib/typography';
import { LOCALES, type Dictionary, type Locale } from '@/lib/types';

/**
 * Name, one line of what this is, the four languages, and whatever contact the
 * configuration actually holds. A contact block with an invented number would
 * be worse than no contact block, so an unset one simply does not appear.
 */
export function SiteFooter({ dictionary, locale, site }: { dictionary: Dictionary; locale: Locale; site: ResolvedSite }) {
  const copy = dictionary.home.footer;
  const { whatsapp, email } = site.contact;
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#2A2419]">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-14 sm:px-10">
        <div className="flex flex-wrap gap-x-16 gap-y-10">
          <div className="flex max-w-sm flex-col gap-2">
            <span className={`${displayFont(locale)} text-lg text-[#F4EFE6]`}>{site.brand}</span>
            <p className="text-sm text-[#786F5D]">{copy.tagline}</p>
          </div>

          <nav className="flex flex-col gap-2">
            <span className="text-xs text-[#786F5D]">{copy.language}</span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {LOCALES.map((option) => (
                <li key={option}>
                  <a
                    href={localeHref(option)}
                    hrefLang={option}
                    lang={option}
                    className={
                      option === locale ? 'text-[#E4C76B]' : 'text-[#A79C86] hover:text-[#F4EFE6]'
                    }
                  >
                    {LOCALE_NAMES[option]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {whatsapp === null && email === null ? null : (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-[#786F5D]">{copy.contact}</span>
              <ul className="flex flex-col gap-1 text-sm text-[#A79C86]">
                {whatsapp === null ? null : (
                  <li>
                    <a
                      dir="ltr"
                      href={`https://wa.me/${whatsapp}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:text-[#F4EFE6]"
                    >
                      +{whatsapp}
                    </a>
                  </li>
                )}
                {email === null ? null : (
                  <li>
                    <a dir="ltr" href={`mailto:${email}`} className="hover:text-[#F4EFE6]">
                      {email}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <p className="text-xs text-[#5C5445]">
          <span dir="ltr">© {year}</span> {site.brand} · {copy.rights}
        </p>
      </div>
    </footer>
  );
}
