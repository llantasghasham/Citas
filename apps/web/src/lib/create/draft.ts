import {
  templateFor,
  themeFor,
  EVENT_TYPES,
  HOST_ROLES,
  LOCALES,
  NUMERAL_SYSTEMS,
  type EventType,
  type HostRole,
  type Invitation,
  type Locale,
  type NumeralSystem,
} from '@/lib/types';
import { isCalendarDate, isClockTime } from '@/lib/time/zoned';
import { findVerse } from '@/lib/verses';

/** Slots offered per person list. Fixed, so the form needs no client JavaScript. */
export const MAX_HONOREES = 2;
export const MAX_HOSTS = 2;

export interface DraftHost {
  name: string;
  role: HostRole;
}

/**
 * The same event written out in one more language.
 *
 * Only the wording travels: names, date and venue live on the event and are
 * shared by every version. Nothing here is translated automatically — the
 * organiser writes each language, which is the whole point of a platform that
 * refuses to transliterate a family name on its own.
 */
export interface DraftTranslation {
  enabled: boolean;
  message: string;
  quoteId: string;
}

const EMPTY_TRANSLATION: DraftTranslation = { enabled: false, message: '', quoteId: '' };

function emptyTranslations(): Record<Locale, DraftTranslation> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, { ...EMPTY_TRANSLATION }]),
  ) as Record<Locale, DraftTranslation>;
}

/** What someone has typed so far. Every field is a string: nothing is trusted yet. */
export interface InvitationDraft {
  locale: Locale;
  eventType: EventType;
  honorees: string[];
  hosts: DraftHost[];
  date: string;
  time: string;
  timeZone: string;
  venueName: string;
  venueAddress: string;
  mapUrl: string;
  message: string;
  quoteId: string;
  numeralSystem: NumeralSystem;
  rsvpEnabled: boolean;
  rsvpDeadline: string;
  /** One entry per language, including the main one, which is ignored. */
  translations: Record<Locale, DraftTranslation>;
}

export const EMPTY_DRAFT: InvitationDraft = {
  locale: 'ar',
  eventType: 'wedding',
  honorees: ['', ''],
  hosts: [
    { name: '', role: 'parents' },
    { name: '', role: 'parents' },
  ],
  date: '',
  time: '',
  timeZone: 'Asia/Beirut',
  venueName: '',
  venueAddress: '',
  mapUrl: '',
  message: '',
  quoteId: '',
  numeralSystem: 'arabic',
  rsvpEnabled: true,
  rsvpDeadline: '',
  translations: emptyTranslations(),
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Reads a draft back from its cookie. Tolerant on purpose: a half-written or
 * tampered draft becomes a valid empty one rather than an error page. Nothing
 * here is trusted — publishing validates again.
 */
export function parseDraft(raw: string | undefined): InvitationDraft {
  if (raw === undefined || raw.length === 0) return EMPTY_DRAFT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_DRAFT;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_DRAFT;

  const draft = parsed as Record<string, unknown>;
  const honorees = Array.isArray(draft['honorees']) ? draft['honorees'] : [];
  const hosts = Array.isArray(draft['hosts']) ? draft['hosts'] : [];

  return {
    locale: oneOf(draft['locale'], LOCALES, EMPTY_DRAFT.locale),
    eventType: oneOf(draft['eventType'], EVENT_TYPES, EMPTY_DRAFT.eventType),
    honorees: Array.from({ length: MAX_HONOREES }, (_, index) => text(honorees[index], 120)),
    hosts: Array.from({ length: MAX_HOSTS }, (_, index) => {
      const host = hosts[index];
      const record = typeof host === 'object' && host !== null ? (host as Record<string, unknown>) : {};
      return {
        name: text(record['name'], 120),
        role: oneOf(record['role'], HOST_ROLES, 'parents'),
      };
    }),
    date: text(draft['date'], 10),
    time: text(draft['time'], 5),
    timeZone: text(draft['timeZone'], 60) || EMPTY_DRAFT.timeZone,
    venueName: text(draft['venueName'], 120),
    venueAddress: text(draft['venueAddress'], 200),
    mapUrl: text(draft['mapUrl'], 500),
    message: text(draft['message'], 600),
    quoteId: text(draft['quoteId'], 80),
    numeralSystem: oneOf(draft['numeralSystem'], NUMERAL_SYSTEMS, 'latin'),
    rsvpEnabled: draft['rsvpEnabled'] !== false,
    rsvpDeadline: text(draft['rsvpDeadline'], 10),
    translations: parseTranslations(draft['translations']),
  };
}

function parseTranslations(raw: unknown): Record<Locale, DraftTranslation> {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  return Object.fromEntries(
    LOCALES.map((locale) => {
      const entry = source[locale];
      const record =
        typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
      return [
        locale,
        {
          enabled: record['enabled'] === true,
          message: text(record['message'], 600),
          quoteId: text(record['quoteId'], 80),
        },
      ];
    }),
  ) as Record<Locale, DraftTranslation>;
}

export interface DraftVersion {
  locale: Locale;
  message: string;
  quoteId: string;
}

/**
 * Every language this draft publishes as, main one first.
 *
 * A verse only survives if it belongs to the language it was picked for: the
 * list is closed per language, so a mismatched id would silently render the
 * wrong script rather than nothing.
 */
export function draftVersions(draft: InvitationDraft): DraftVersion[] {
  const versionFor = (locale: Locale, message: string, quoteId: string): DraftVersion => ({
    locale,
    message,
    quoteId: findVerse(quoteId)?.locale === locale ? quoteId : '',
  });

  const extra = LOCALES.filter(
    (locale) => locale !== draft.locale && draft.translations[locale].enabled,
  ).map((locale) => {
    const translation = draft.translations[locale];
    return versionFor(locale, translation.message, translation.quoteId);
  });

  return [versionFor(draft.locale, draft.message, draft.quoteId), ...extra];
}

export function serializeDraft(draft: InvitationDraft): string {
  return JSON.stringify(draft);
}

/**
 * La fecha se comprueba contra el CALENDARIO, no contra una expresión.
 *
 * `^\\d{4}-\\d{2}-\\d{2}$` deja pasar un 30 de febrero, y lo que viene detrás no
 * protesta: `new Date('2026-02-30')` es el 2 de marzo. Así se publicaba una
 * invitación con una fecha y su `.ics` llevaba otra, sin un solo aviso.
 */
const isDate = isCalendarDate;
const isTime = isClockTime;

/** Field names that are not yet good enough to publish. */
export function draftProblems(draft: InvitationDraft): string[] {
  const problems: string[] = [];
  if (draft.honorees.every((name) => name.length === 0)) problems.push('honorees');
  if (!isDate(draft.date)) problems.push('date');
  if (!isTime(draft.time)) problems.push('time');
  if (draft.venueName.length === 0) problems.push('venueName');
  if (draft.venueAddress.length === 0) problems.push('venueAddress');
  if (draft.rsvpEnabled && draft.rsvpDeadline.length > 0 && !isDate(draft.rsvpDeadline)) {
    problems.push('rsvpDeadline');
  }
  return problems;
}

/** When no map link was given, point at a search for the address itself. */
export function mapUrlFor(draft: InvitationDraft): string {
  if (draft.mapUrl.startsWith('http://') || draft.mapUrl.startsWith('https://')) {
    return draft.mapUrl;
  }
  const query = encodeURIComponent(`${draft.venueName} ${draft.venueAddress}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * Turns the draft into something the real card component can render, so the
 * preview is the invitation itself and not a second, drifting mock-up.
 */
export function draftToInvitation(draft: InvitationDraft): Invitation {
  const verse = draft.quoteId.length === 0 ? undefined : findVerse(draft.quoteId);

  return {
    id: 'draft',
    slug: 'draft',
    eventType: draft.eventType,
    locale: draft.locale,
    direction: draft.locale === 'ar' ? 'rtl' : 'ltr',
    templateId: templateFor(draft.eventType),
    numeralSystem: draft.numeralSystem,
    hosts: draft.hosts.filter((host) => host.name.length > 0),
    honorees: draft.honorees.filter((name) => name.length > 0).map((name) => ({ name })),
    date: isDate(draft.date) ? draft.date : '2026-01-01',
    time: isTime(draft.time) ? draft.time : '00:00',
    timeZone: draft.timeZone,
    venue: {
      name: draft.venueName,
      address: draft.venueAddress,
      mapUrl: mapUrlFor(draft),
      lat: null,
      lng: null,
    },
    message: draft.message,
    quote: verse === undefined ? undefined : { text: verse.text, source: verse.source },
    quoteId: draft.quoteId.length === 0 ? undefined : draft.quoteId,
    theme: themeFor(draft.eventType),
    rsvp: {
      enabled: draft.rsvpEnabled,
      deadline: isDate(draft.rsvpDeadline) ? draft.rsvpDeadline : null,
    },
  };
}
