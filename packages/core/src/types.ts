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

export const TEMPLATE_IDS = ['classic-gold', 'sober-memorial'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const NUMERAL_SYSTEMS = ['arabic', 'latin'] as const;
/** `arabic` = Eastern Arabic numerals (٠١٢٣), `latin` = Western Arabic numerals (0123). */
export type NumeralSystem = (typeof NUMERAL_SYSTEMS)[number];

/** The selling points the home page can show. Which ones it shows is config. */
export const FEATURE_KEYS = [
  'languages',
  'whatsapp',
  'rsvp',
  'image',
  'verses',
  'offices',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** The questions the home page can answer. */
export const FAQ_KEYS = ['guestApp', 'languages', 'payment', 'print', 'ownNumber'] as const;
export type FaqKey = (typeof FAQ_KEYS)[number];

/** The plans the home page can price. Mirrors the billing catalogue's tiers. */
export const PLAN_KEYS = ['free', 'single_event', 'annual', 'office'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** The chapters of the in-app manual, in the order the panel shows them. */
export const MANUAL_CHAPTERS = [
  'signIn',
  'create',
  'languages',
  'guests',
  'send',
  'rsvp',
  'image',
  'team',
] as const;
export type ManualChapter = (typeof MANUAL_CHAPTERS)[number];

/** The moving parts the status page names, each with its own version. */
export const STACK_KEYS = [
  'node',
  'next',
  'react',
  'typescript',
  'tailwind',
  'prisma',
  'database',
  'puppeteer',
  'mailer',
  'expo',
  'reactNative',
] as const;
export type StackKey = (typeof STACK_KEYS)[number];

/** What the status page checks before saying the system is healthy. */
export const HEALTH_KEYS = [
  'database',
  'dataSource',
  'mailer',
  'payments',
  'renderStore',
  'secretKey',
  'chromium',
  'superadmin',
  'extraSuperadmins',
] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];

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
  /** Optional: most hosts do not know them, and 0,0 would be a lie. */
  lat: number | null;
  lng: number | null;
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
  /** The creation flow. Reuses `labels` and `roles` rather than repeating them. */
  create: {
    title: string;
    stepOf: string;
    next: string;
    back: string;
    publish: string;
    preview: string;
    steps: Record<'language' | 'names' | 'when' | 'details' | 'translations' | 'review', string>;
    localeLabel: string;
    eventTypeLabel: string;
    honoreesLabel: string;
    hostsLabel: string;
    hostRoleLabel: string;
    optional: string;
    timeZoneLabel: string;
    mapUrlLabel: string;
    messageLabel: string;
    quoteLabel: string;
    quoteNone: string;
    numeralsLabel: string;
    numeralsArabic: string;
    numeralsLatin: string;
    rsvpLabel: string;
    rsvpYes: string;
    rsvpNo: string;
    rsvpDeadlineLabel: string;
    signInToPublish: string;
    publishedTitle: string;
    publishedHint: string;
    openInvitation: string;
    downloadImage: string;
    startOver: string;
    errorInvalid: string;
    /** The extra languages the same event is also written in. */
    translationsHint: string;
    translationEnable: string;
    translationMessageLabel: string;
    translationSharedNote: string;
    reviewLanguages: string;
    reviewLanguagesNone: string;
  };
  /**
   * The public home page. Marketing copy, one entry per block: what the page
   * shows is decided in `config/site.ts`, what it says is decided here.
   */
  home: {
    nav: {
      features: string;
      how: string;
      templates: string;
      pricing: string;
      faq: string;
      signIn: string;
      cta: string;
    };
    hero: {
      badge: string;
      titleLead: string;
      titleHighlight: string;
      subtitle: string;
      ctaPrimary: string;
      ctaSecondary: string;
      proof: Record<'languages' | 'noApp' | 'whatsapp', string>;
    };
    features: {
      heading: string;
      subheading: string;
      items: Record<FeatureKey, { title: string; body: string }>;
    };
    steps: {
      heading: string;
      subheading: string;
      items: Record<'write' | 'send' | 'track', { title: string; body: string }>;
    };
    showcase: {
      heading: string;
      subheading: string;
      open: string;
      empty: string;
    };
    pricing: {
      heading: string;
      subheading: string;
      perEvent: string;
      perMonth: string;
      free: string;
      cta: string;
      note: string;
      benefits: Record<PlanKey, string>;
    };
    faq: {
      heading: string;
      items: Record<FaqKey, { question: string; answer: string }>;
    };
    closing: {
      heading: string;
      body: string;
      cta: string;
    };
    footer: {
      tagline: string;
      language: string;
      contact: string;
      rights: string;
    };
  };
  /** Text that leaves the platform, in the guest's own language. */
  share: {
    whatsappMessage: string;
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
      /** The way in when the mail is not moving. Not offered to the end client. */
      passwordLink: string;
      passwordLabel: string;
      passwordSubmit: string;
      passwordHint: string;
      codeLink: string;
    };
    panel: {
      title: string;
      signedInAs: string;
      office: string;
      role: string;
      noOffice: string;
      signOut: string;
      /** Shown when React Native needs a relaunch to flip text direction. */
      restartNeeded: string;
    };
    roles: Record<'SUPERADMIN' | 'TENANT_ADMIN' | 'OPERATOR' | 'ORGANIZER', string>;
    nav: Record<'events' | 'offices' | 'team' | 'billing' | 'manual' | 'system', string>;
    /** The manual the office reads inside the panel, not in a PDF nobody opens. */
    manual: {
      title: string;
      intro: string;
      chapters: Record<ManualChapter, { title: string; steps: string[] }>;
    };
    /** What this installation is running, and whether it is healthy. */
    system: {
      title: string;
      intro: string;
      stack: {
        heading: string;
        component: string;
        version: string;
        purpose: string;
        purposes: Record<StackKey, string>;
      };
      health: {
        heading: string;
        ok: string;
        warn: string;
        fail: string;
        checks: Record<HealthKey, string>;
      };
      /** Sends one real message, so the mail can be diagnosed from here. */
      mail: {
        heading: string;
        intro: string;
        test: string;
        ok: string;
        failed: string;
        tooSoon: string;
      };
      updates: {
        heading: string;
        intro: string;
        warning: string;
        howTo: string;
        checkCommand: string;
        updateCommand: string;
      };
    };
    offices: {
      heading: string;
      name: string;
      subdomain: string;
      plan: string;
      status: string;
      create: string;
      empty: string;
      defaultLocale: string;
    };
    team: {
      heading: string;
      email: string;
      role: string;
      add: string;
      empty: string;
      added: string;
    };
    billing: {
      heading: string;
      plan: string;
      limits: string;
      eventsUsed: string;
      unlimited: string;
      orders: string;
      amount: string;
      state: string;
      created: string;
      pay: string;
      noOrders: string;
      choosePlan: string;
      planFree: string;
      planSingle: string;
      planAnnual: string;
      planOffice: string;
      limitReached: string;
    };
    guests: {
      heading: string;
      import: string;
      importHint: string;
      pasteLabel: string;
      fileLabel: string;
      countryLabel: string;
      add: string;
      name: string;
      phone: string;
      link: string;
      opened: string;
      reply: string;
      notOpened: string;
      pending: string;
      empty: string;
      sendWhatsapp: string;
      exportCsv: string;
      imported: string;
      skipped: string;
      openedCount: string;
      language: string;
      fallbackWarning: string;
    };
    /** One invitation, written out in each language its guests read. */
    versions: {
      heading: string;
      hint: string;
      open: string;
      addIn: string;
      add: string;
      added: string;
      complete: string;
      quoteHint: string;
    };
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
