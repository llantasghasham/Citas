import ar from '../locales/ar.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import pt from '../locales/pt.json';

import type { Dictionary, Locale } from './types';

/**
 * The explicit `Record<Locale, Dictionary>` annotation makes TypeScript check
 * every locale file against the Dictionary interface at build time: a missing
 * or misspelled key in any of the four files fails `npm run typecheck`.
 */
const DICTIONARIES: Record<Locale, Dictionary> = { ar, en, es, pt };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function interpolate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
