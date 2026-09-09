import versesFile from '../../data/verses.json';

import { asArray, asEnum, asOptionalString, asRecord, asString } from './validate';
import { LOCALES, type Locale, type Quote } from './types';

export interface Verse extends Quote {
  id: string;
  locale: Locale;
  tradition: string;
  /**
   * Who checked this text against the edition it cites. Null means nobody has,
   * which is a fact about the file and never something to paper over: the rule
   * is that an entry is added only after a person verifies it.
   */
  verifiedBy: string | null;
}

/**
 * Religious texts are read from a fixed, human-verified list and never
 * generated, completed or corrected at runtime. A quote whose id is absent from
 * data/verses.json is simply not rendered — see the `_policy` note in that file.
 */
function parseVerses(): Map<string, Verse> {
  const root = asRecord(versesFile, 'verses.json');
  const entries = asArray(root['verses'], 'verses.json#/verses');
  const byId = new Map<string, Verse>();

  entries.forEach((entry, index) => {
    const path = `verses.json#/verses/${index}`;
    const record = asRecord(entry, path);
    const verse: Verse = {
      id: asString(record['id'], `${path}/id`),
      locale: asEnum(record['locale'], LOCALES, `${path}/locale`),
      tradition: asString(record['tradition'], `${path}/tradition`),
      text: asString(record['text'], `${path}/text`),
      source: asString(record['source'], `${path}/source`),
      verifiedBy: asOptionalString(record['verifiedBy'], `${path}/verifiedBy`) ?? null,
    };
    byId.set(verse.id, verse);
  });

  return byId;
}

const VERSES = parseVerses();

export function findVerse(id: string): Verse | undefined {
  return VERSES.get(id);
}

/**
 * The sacred texts nobody has checked yet.
 *
 * They are still rendered — refusing to draw them would take down invitations
 * already sent — but the platform must not be quiet about it: a misquoted
 * Qur'anic verse on a wedding invitation is not something a later deploy fixes.
 */
export function unverifiedVerses(): Verse[] {
  return [...VERSES.values()].filter((verse) => verse.verifiedBy === null);
}

/** The verses offered for a language. Nothing outside this list can be chosen. */
export function listVerses(locale: Locale): Verse[] {
  return [...VERSES.values()].filter((verse) => verse.locale === locale);
}
