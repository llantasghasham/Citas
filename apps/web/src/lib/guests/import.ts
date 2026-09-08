import { LOCALES, type Locale } from '@citas/core';

import { toE164 } from './phone';

export interface ImportedGuest {
  name: string;
  phone: string | null;
  locale: Locale;
}

export interface ImportResult {
  guests: ImportedGuest[];
  skipped: number;
}

/** A row is `name, phone, locale?` separated by comma, semicolon or tab. */
function splitRow(line: string): string[] {
  return line
    .split(/[,;\t]/)
    .map((cell) => cell.trim().replace(/^"(.*)"$/, '$1').trim());
}

const HEADER_WORDS = /^(name|nombre|nome|الاسم|guest|invitado|convidado)$/i;

/**
 * Turns a pasted list — or a CSV the client sent from their phone — into
 * guests. Deliberately forgiving about separators and spacing, and deliberately
 * strict about what it accepts: a row without a usable name is skipped and
 * counted rather than imported as an empty guest nobody can identify.
 */
export function parseGuestList(
  input: string,
  defaultCountry: string,
  fallbackLocale: Locale,
): ImportResult {
  const guests: ImportedGuest[] = [];
  let skipped = 0;

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;

    const cells = splitRow(line);
    const name = cells[0] ?? '';

    // A first row that says "name" is a header, not a person.
    if (index === 0 && HEADER_WORDS.test(name)) continue;

    if (name.length === 0 || name.length > 120) {
      skipped += 1;
      continue;
    }

    const locale = LOCALES.find((candidate) => candidate === cells[2]?.toLowerCase());

    guests.push({
      name,
      phone: cells[1] === undefined ? null : toE164(cells[1], defaultCountry),
      locale: locale ?? fallbackLocale,
    });
  }

  return { guests, skipped };
}
