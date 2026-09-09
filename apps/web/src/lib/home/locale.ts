import { LOCALES, type Locale } from '@/lib/types';

/**
 * Which language the home page speaks.
 *
 * An explicit `?lang=` wins, because that is what the switcher sets and what a
 * shared link should keep. Otherwise the browser's own preference decides, so
 * a phone in Beirut opens in Arabic without anybody choosing. Falls back to the
 * configured default.
 */
export function resolveHomeLocale(
  requested: string | undefined,
  acceptLanguage: string,
  fallback: Locale = 'ar',
): Locale {
  const explicit = LOCALES.find((locale) => locale === requested);
  if (explicit !== undefined) return explicit;

  const preferred = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', q = 'q=1'] = part.trim().split(';');
      return { tag: tag.trim().toLowerCase(), weight: Number.parseFloat(q.replace('q=', '')) || 0 };
    })
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of preferred) {
    // `ar-LB` and `pt-BR` are the normal shape of this header: match on the
    // primary subtag, not on the whole thing.
    const primary = tag.split('-')[0];
    const match = LOCALES.find((locale) => locale === primary);
    if (match !== undefined) return match;
  }

  return fallback;
}

/** The same page in another language, keeping the reader where they are. */
export function localeHref(locale: Locale): string {
  return `/?lang=${locale}`;
}
