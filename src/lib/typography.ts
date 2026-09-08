import type { Locale } from './types';

/**
 * Font pairing per script. Arabic uses Amiri throughout (a display/body split
 * would break the vertical rhythm of the script); Latin scripts pair Playfair
 * Display for headings with Inter for running text.
 */
export function displayFont(locale: Locale): string {
  return locale === 'ar' ? 'font-arabic' : 'font-display';
}

export function bodyFont(locale: Locale): string {
  return locale === 'ar' ? 'font-arabic' : 'font-body';
}

/** Italics are a Latin convention; Arabic is never slanted. */
export function quoteEmphasis(locale: Locale): string {
  return locale === 'ar' ? 'not-italic' : 'italic';
}

/**
 * Letter-spacing and casing are Latin typographic devices: applying them to
 * Arabic breaks the cursive joins. Anything spacing-related goes through here.
 */
export function latinOnly(locale: Locale, classes: string): string {
  return locale === 'ar' ? '' : classes;
}
