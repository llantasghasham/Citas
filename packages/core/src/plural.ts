import type { Locale } from './types';

/**
 * The plural forms a language actually uses. `other` is the only one every
 * language has, so it is the only one required.
 *
 * Spanish, Portuguese and English need `one` and `other`. Arabic needs six, and
 * the difference is not pedantry: "١ مدعوّين" reads to a Lebanese client the way
 * "1 guests" reads to an English one.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * Picks the form this language uses for this number, and puts the number in.
 *
 * `Intl.PluralRules` knows every language's rules, so nothing here has to.
 * A language that asks for a form the dictionary does not carry falls back to
 * `other`, which is always present.
 */
export function plural(
  locale: Locale,
  forms: PluralForms,
  count: number,
  extra: Readonly<Record<string, string>> = {},
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const template = forms[category] ?? forms.other;

  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key === 'count' ? String(count) : (extra[key] ?? match),
  );
}
