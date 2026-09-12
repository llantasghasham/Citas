import invitationsFile from '../../data/invitations.json';

import {
  DIRECTIONS,
  EVENT_TYPES,
  HOST_ROLES,
  LOCALES,
  NUMERAL_SYSTEMS,
  TEMPLATE_IDS,
  type Honoree,
  type Host,
  type Invitation,
  type Quote,
  type Rsvp,
  type Theme,
  type Venue,
} from './types';
import {
  DataError,
  asArray,
  asBoolean,
  asColour,
  asEnum,
  asHttpUrl,
  asIsoDate,
  asNumber,
  asOptionalString,
  asRecord,
  asString,
  asTime,
} from './validate';
import { findVerse, verseExists } from './verses';

function parseHosts(value: unknown, path: string): Host[] {
  return asArray(value, path).map((entry, index) => {
    const record = asRecord(entry, `${path}/${index}`);
    return {
      name: asString(record['name'], `${path}/${index}/name`),
      role: asEnum(record['role'], HOST_ROLES, `${path}/${index}/role`),
    };
  });
}

function parseHonorees(value: unknown, path: string): Honoree[] {
  const honorees = asArray(value, path).map((entry, index) => ({
    name: asString(asRecord(entry, `${path}/${index}`)['name'], `${path}/${index}/name`),
  }));
  if (honorees.length === 0) throw new DataError(path, 'at least one honoree', value);
  return honorees;
}

function parseVenue(value: unknown, path: string): Venue {
  const record = asRecord(value, path);
  return {
    name: asString(record['name'], `${path}/name`),
    address: asString(record['address'], `${path}/address`),
    mapUrl: asHttpUrl(record['mapUrl'], `${path}/mapUrl`),
    lat: record['lat'] === undefined || record['lat'] === null ? null : asNumber(record['lat'], `${path}/lat`),
    lng: record['lng'] === undefined || record['lng'] === null ? null : asNumber(record['lng'], `${path}/lng`),
  };
}

function parseTheme(value: unknown, path: string): Theme {
  const record = asRecord(value, path);
  return {
    primary: asColour(record['primary'], `${path}/primary`),
    accent: asColour(record['accent'], `${path}/accent`),
    background: asColour(record['background'], `${path}/background`),
  };
}

function parseRsvp(value: unknown, path: string): Rsvp {
  const record = asRecord(value, path);
  const deadline = record['deadline'];
  return {
    enabled: asBoolean(record['enabled'], `${path}/enabled`),
    deadline: deadline === null || deadline === undefined ? null : asIsoDate(deadline, `${path}/deadline`),
  };
}

function parseQuote(quoteId: string | undefined, path: string): Quote | undefined {
  if (quoteId === undefined) return undefined;
  // Un id que NO está en la lista es un archivo mal escrito y se dice a gritos.
  if (!verseExists(quoteId)) {
    throw new DataError(path, 'an id present in data/verses.json', quoteId);
  }
  // Pero uno que está y no se ha verificado no es un error del archivo: es una
  // tarea pendiente de una persona. La invitación sale SIN versículo, que es
  // exactamente lo que se decidió, en vez de tumbar el build o —peor— imprimir
  // texto sagrado que nadie ha comprobado.
  const verse = findVerse(quoteId);
  if (verse === undefined) return undefined;
  return { text: verse.text, source: verse.source };
}

export function parseInvitation(value: unknown, path: string): Invitation {
  const record = asRecord(value, path);
  const locale = asEnum(record['locale'], LOCALES, `${path}/locale`);
  const direction = asEnum(record['direction'], DIRECTIONS, `${path}/direction`);
  const expectedDirection = locale === 'ar' ? 'rtl' : 'ltr';
  if (direction !== expectedDirection) {
    throw new DataError(`${path}/direction`, `"${expectedDirection}" for locale "${locale}"`, direction);
  }

  const quoteId = asOptionalString(record['quoteId'], `${path}/quoteId`);

  return {
    id: asString(record['id'], `${path}/id`),
    slug: asString(record['slug'], `${path}/slug`),
    eventType: asEnum(record['eventType'], EVENT_TYPES, `${path}/eventType`),
    locale,
    direction,
    templateId: asEnum(record['templateId'], TEMPLATE_IDS, `${path}/templateId`),
    numeralSystem: asEnum(record['numeralSystem'], NUMERAL_SYSTEMS, `${path}/numeralSystem`),
    hosts: parseHosts(record['hosts'], `${path}/hosts`),
    honorees: parseHonorees(record['honorees'], `${path}/honorees`),
    date: asIsoDate(record['date'], `${path}/date`),
    time: asTime(record['time'], `${path}/time`),
    timeZone: asOptionalString(record['timeZone'], `${path}/timeZone`) ?? 'Asia/Beirut',
    hijriDate: asOptionalString(record['hijriDate'], `${path}/hijriDate`),
    venue: parseVenue(record['venue'], `${path}/venue`),
    message: asString(record['message'], `${path}/message`),
    quote: parseQuote(quoteId, `${path}/quoteId`),
    quoteId,
    theme: parseTheme(record['theme'], `${path}/theme`),
    rsvp: parseRsvp(record['rsvp'], `${path}/rsvp`),
  };
}

function loadInvitations(): Map<string, Invitation> {
  const root = asRecord(invitationsFile, 'invitations.json');
  const entries = asArray(root['invitations'], 'invitations.json#/invitations');
  const bySlug = new Map<string, Invitation>();

  entries.forEach((entry, index) => {
    const invitation = parseInvitation(entry, `invitations.json#/invitations/${index}`);
    if (bySlug.has(invitation.slug)) {
      throw new DataError(`invitations.json#/invitations/${index}/slug`, 'a unique slug', invitation.slug);
    }
    bySlug.set(invitation.slug, invitation);
  });

  return bySlug;
}

/** Parsed once per process; the JSON store is replaced by Prisma in phase 2. */
const INVITATIONS = loadInvitations();

export function getInvitationBySlug(slug: string): Invitation | undefined {
  return INVITATIONS.get(slug);
}

export function getAllInvitations(): Invitation[] {
  return [...INVITATIONS.values()];
}
