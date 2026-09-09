import type { Locale, NumeralSystem } from '@/lib/types';

/** Eastern numerals are the sensible default for Arabic and wrong elsewhere. */
export function defaultNumerals(locale: Locale): NumeralSystem {
  return locale === 'ar' ? 'arabic' : 'latin';
}

/**
 * Language names are written in their own language, so they read the same in
 * every dictionary and do not belong in the locale files.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  ar: 'العربية',
  es: 'Español',
  pt: 'Português',
  en: 'English',
};

/** The zones this market actually uses. A full IANA list would help nobody. */
export const TIME_ZONES = [
  'Asia/Beirut',
  'Asia/Dubai',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/London',
  'America/Costa_Rica',
  'America/Sao_Paulo',
  'UTC',
] as const;
