/**
 * Domain types for the invitation render engine.
 * Every user-visible label is resolved through a Dictionary; only proper nouns
 * and free-text authored by the event host live inside an Invitation.
 */

export const LOCALES = ['ar', 'es', 'pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const EVENT_TYPES = ['wedding', 'graduation', 'birthday', 'baptism', 'memorial'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const HOST_ROLES = [
  'parents',
  'father',
  'mother',
  'family',
  'couple',
  'self',
  'institution',
  'host',
] as const;
export type HostRole = (typeof HOST_ROLES)[number];

export const TEMPLATE_IDS = ['classic-gold'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const NUMERAL_SYSTEMS = ['arabic', 'latin'] as const;
/** `arabic` = Eastern Arabic numerals (٠١٢٣), `latin` = Western Arabic numerals (0123). */
export type NumeralSystem = (typeof NUMERAL_SYSTEMS)[number];

export const DIRECTIONS = ['rtl', 'ltr'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface Host {
  /** Proper noun, rendered as authored. */
  name: string;
  /** Translatable relationship label, resolved from the dictionary. */
  role: HostRole;
}

export interface Honoree {
  name: string;
}

export interface Venue {
  name: string;
  address: string;
  mapUrl: string;
  lat: number;
  lng: number;
}

export interface Quote {
  text: string;
  source: string;
}

export interface Theme {
  primary: string;
  accent: string;
  background: string;
}

export interface Rsvp {
  enabled: boolean;
  /** ISO date (YYYY-MM-DD) or null when no deadline applies. */
  deadline: string | null;
}

export interface Invitation {
  id: string;
  slug: string;
  eventType: EventType;
  locale: Locale;
  direction: Direction;
  templateId: TemplateId;
  numeralSystem: NumeralSystem;
  hosts: Host[];
  honorees: Honoree[];
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  /** 24h wall-clock time at the venue, HH:mm. */
  time: string;
  /** IANA zone of the venue, needed to turn that wall clock into an instant. */
  timeZone: string;
  /** Pre-computed Hijri date string. Never derived at runtime — see data/verses.json policy. */
  hijriDate?: string;
  venue: Venue;
  /** Free text authored by the host, already in `locale`. */
  message: string;
  /** Resolved from data/verses.json when `quoteId` is set; never generated. */
  quote?: Quote;
  /** Identifier into data/verses.json. */
  quoteId?: string;
  theme: Theme;
  rsvp: Rsvp;
}

/** Shape of every file in /locales. Enforced at compile time in src/lib/dictionary.ts. */
export interface Dictionary {
  meta: {
    pageTitle: string;
    pageDescription: string;
  };
  eventTypes: Record<EventType, string>;
  invite: Record<EventType, { kicker: string; intro: string }>;
  roles: Record<HostRole, string>;
  labels: {
    date: string;
    time: string;
    hijriDate: string;
    venue: string;
    address: string;
    quoteSource: string;
  };
  rsvp: {
    withDeadline: string;
    withoutDeadline: string;
  };
  actions: {
    viewMap: string;
    addToCalendar: string;
  };
  /** The reply form the guest fills in. */
  rsvpForm: {
    heading: string;
    nameLabel: string;
    partyLabel: string;
    messageLabel: string;
    attending: string;
    declined: string;
    tentative: string;
    submit: string;
    thanksAttending: string;
    thanksDeclined: string;
    thanksTentative: string;
    change: string;
    closed: string;
    error: string;
  };
  aria: {
    invitationCard: string;
    ornament: string;
  };
  /** Staff-facing screens. Office staff in Beirut read these in Arabic too. */
  admin: {
    signIn: {
      title: string;
      emailLabel: string;
      emailHint: string;
      send: string;
      sent: string;
      codeLabel: string;
      verify: string;
      invalid: string;
      otherEmail: string;
    };
    panel: {
      title: string;
      signedInAs: string;
      office: string;
      role: string;
      noOffice: string;
      signOut: string;
    };
    roles: Record<'SUPERADMIN' | 'TENANT_ADMIN' | 'OPERATOR' | 'ORGANIZER', string>;
    events: {
      heading: string;
      event: string;
      date: string;
      attending: string;
      declined: string;
      tentative: string;
      guests: string;
      download: string;
      empty: string;
    };
  };
}
