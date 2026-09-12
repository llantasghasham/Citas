import type { PluralForms } from './plural';

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
  'tables',
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
  'interface',
  'profile',
  'create',
  'acts',
  'segments',
  'preview',
  'languages',
  'guests',
  'send',
  'whatsappQr',
  'consent',
  'packages',
  'rsvp',
  'tables',
  'gate',
  'preferences',
  'image',
  'team',
  'roles',
  'config',
  'system',
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

/**
 * Los sectores de la pantalla de configuración. El orden es el de la pantalla.
 */
export const CONFIG_SECTIONS = [
  'mail',
  'payments',
  'whatsapp',
  'sinpe',
  'roles',
  'brand',
  'home',
  'site',
] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

/**
 * Cómo se puede cobrar. `cash` no es una pasarela: es que alguien de la oficina
 * recibe el dinero y lo anota, y por eso lo marca una persona con su nombre.
 */
export const PAYMENT_METHODS = ['whish', 'cash', 'sinpe', 'tilopay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What the status page checks before saying the system is healthy. */
export const HEALTH_KEYS = [
  'database',
  'dataSource',
  'mailer',
  'senderDns',
  'payments',
  'renderStore',
  'secretKey',
  'chromium',
  'superadmin',
  'extraSuperadmins',
  'siteUrl',
  'codeDelivery',
  'migrations',
  'whatsapp',
  'tenancy',
  'verses',
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
  /** Cómo se llama cada acto. Un solo sitio: lo leen el panel y la invitación. */
  actTypes: {
    engagement: string;
    family_party: string;
    henna: string;
    preparation: string;
    zaffe: string;
    ceremony: string;
    dinner: string;
    reception: string;
    farewell: string;
    other: string;
  };
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
    /** En qué mesa se sienta, cuando la oficina ya ha repartido el salón. */
    yourTable: string;
  };
  agenda: {
    heading: string;
    yours: string;
    optional: string;
    closed: string;
    replyTo: string;
    noReplies: string;
    until: string;
    saved: string;
  };
  /**
   * Lo que el invitado dice que necesita. Las CLAVES y los VALORES son listas
   * cerradas en el servidor (`lib/checkin/preferences.ts`); esto es solo cómo
   * se leen en cada idioma. Añadir una opción es tocar los dos sitios.
   */
  preferences: {
    heading: string;
    hint: string;
    none: string;
    save: string;
    saved: string;
    forAct: string;
    perAct: string;
    keys: {
      diet: string;
      transport: string;
      accessibility: string;
      photos: string;
    };
    options: {
      diet: {
        vegetarian: string;
        vegan: string;
        gluten_free: string;
        lactose_free: string;
        nut_allergy: string;
        no_pork: string;
        no_alcohol: string;
      };
      transport: {
        own_car: string;
        needs_parking: string;
        shuttle: string;
        needs_ride: string;
      };
      accessibility: {
        wheelchair: string;
        step_free: string;
        reserved_seat: string;
        hearing: string;
      };
      photos: {
        ok: string;
        no: string;
      };
    };
  };
  aria: {
    invitationCard: string;
    ornament: string;
  };
  /** The creation flow. Reuses `labels` and `roles` rather than repeating them. */
  create: {
    title: string;
    backToPanel: string;
    backHome: string;
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
    /** El segundo mensaje, al que no contestó. Lleva `{name}` y `{link}`. */
    reminderMessage: string;
  };
  /**
   * La pantalla pública de pago, `/pagar/<token>`. La lee la pareja que se
   * casa, que no tiene cuenta aquí, así que habla su idioma y no el de la
   * oficina.
   */
  pay: {
    heading: string;
    fromOffice: string;
    forWedding: string;
    packageLabel: string;
    guestsLine: string;
    total: string;
    payNow: string;
    hosted: string;
    paidTitle: string;
    paidBody: string;
    pendingTitle: string;
    pendingBody: string;
    checkAgain: string;
    failedTitle: string;
    failedBody: string;
    providerError: string;
    notFound: string;
    cashTitle: string;
    cashDefault: string;
    orNothing: string;
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
      /** El rótulo del icono de mundo que cambia el idioma. */
      language: string;
      /** Shown when React Native needs a relaunch to flip text direction. */
      restartNeeded: string;
    };
    roles: Record<'SUPERADMIN' | 'TENANT_ADMIN' | 'OPERATOR' | 'ORGANIZER', string>;
    nav: Record<
      | 'events'
      | 'create'
      | 'offices'
      | 'team'
      | 'billing'
      | 'manual'
      | 'system'
      | 'config'
      | 'profile',
      string
    >;
    /** La configuración del sistema, editable sin entrar al servidor. */
    config: {
      title: string;
      intro: string;
      save: string;
      saved: string;
      fromPanel: string;
      fromEnv: string;
      missing: string;
      secretSet: string;
      secretUnset: string;
      secretHint: string;
      /** Los títulos de cada sector de la pantalla. */
      sections: Record<ConfigSection, string>;
      /** Una línea que dice para qué sirve cada sector. */
      sectionIntros: Record<ConfigSection, string>;
      mail: string;
      payments: string;
      site: string;
      methods: { heading: string } & Record<PaymentMethod, string>;
      methodsHint: string;
      tilopayPending: string;
      homeLanguage: string;
      homeReset: string;
      homeOriginal: string;
      homeSections: string;
      brandPreview: string;
      /** El logo y el icono, que se SUBEN. */
      brandLogo: string;
      brandLogoHint: string;
      brandIcon: string;
      brandIconHint: string;
      brandRemove: string;
      brandByUrl: string;
      /** Lleva `{mb}`. */
      brandTooBig: string;
      brandNotAnImage: string;
      /** El reparto de permisos por rol. */
      roles: {
        capability: Record<
          'platform:manage' | 'tenant:manage' | 'tenant:staff' | 'event:write' | 'event:read' | 'billing:manage',
          string
        >;
        fixed: string;
        custom: string;
        reset: string;
        neverGrantable: string;
      };
      testMail: string;
      testPayments: string;
      probeOk: string;
      probeFailed: string;
      /**
       * De dónde sale cada valor y qué forma tiene. No todos lo necesitan:
       * los que sí, son los que hacen perder una tarde si se escriben mal.
       */
      hints: Partial<
        Record<
          | 'MAILER'
          | 'MAIL_FROM'
          | 'PAYMENTS_PROVIDER'
          | 'WHISH_BASE_URL'
          | 'WHISH_CHANNEL'
          | 'WHISH_WEBSITE_URL'
          | 'WHISH_SECRET'
          | 'CONTACT_WHATSAPP'
          | 'HOME_SECTIONS'
          | 'WHATSAPP_GATEWAY_URL'
          | 'WHATSAPP_DELAY_MIN'
          | 'WHATSAPP_DELAY_MAX'
          | 'WHATSAPP_WARMUP_CAP'
          | 'WHATSAPP_QR_FROZEN',
          string
        >
      >;
      labels: Record<
        | 'MAILER'
        | 'SMTP_HOST'
        | 'SMTP_PORT'
        | 'SMTP_USER'
        | 'MAIL_FROM'
        | 'SMTP_PASSWORD'
        | 'PAYMENTS_PROVIDER'
        | 'WHISH_BASE_URL'
        | 'WHISH_CHANNEL'
        | 'WHISH_WEBSITE_URL'
        | 'WHISH_SECRET'
        | 'PAYMENT_METHODS'
        | 'CASH_INSTRUCTIONS'
        | 'SINPE_PHONE'
        | 'CRC_PER_USD'
        | 'TILOPAY_BASE_URL'
        | 'TILOPAY_API_USER'
        | 'TILOPAY_API_KEY'
        | 'TILOPAY_PASSWORD'
        | 'BRAND_NAME'
        | 'BRAND_LOGO_URL'
        | 'BRAND_ICON_URL'
        | 'CONTACT_WHATSAPP'
        | 'CONTACT_EMAIL'
        | 'HOME_SECTIONS'
        | 'HOME_SHOWCASE'
        | 'HOME_DEFAULT_LOCALE'
        | 'WHATSAPP_GATEWAY_URL'
        | 'WHATSAPP_DELAY_MIN'
        | 'WHATSAPP_DELAY_MAX'
        | 'WHATSAPP_WARMUP_CAP'
        | 'WHATSAPP_QR_FROZEN'
        | 'NEXT_PUBLIC_SITE_URL',
        string
      >;
    };
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
      name: string;
      locale: string;
      country: string;
      save: string;
    };
    /** Lo que cada persona edita de sí misma. */
    profile: {
      title: string;
      intro: string;
      name: string;
      phone: string;
      locale: string;
      country: string;
      countryHint: string;
      save: string;
      saved: string;
      noCountry: string;
      email: string;
      emailHint: string;
      timezone: string;
      timezoneHint: string;
      timezoneAuto: string;
      photo: {
        label: string;
        hint: string;
        remove: string;
        /** Lleva `{mb}`. */
        tooBig: string;
        notAnImage: string;
      };
      password: {
        title: string;
        intro: string;
        introNone: string;
        current: string;
        next: string;
        repeat: string;
        /** Lleva `{n}`. */
        rule: string;
        change: string;
        set: string;
        saved: string;
        /** Por qué no se pudo, con la clave que devuelve la acción. */
        errors: {
          notAllowed: string;
          mismatch: string;
          wrongCurrent: string;
          tooShort: string;
          padded: string;
          generic: string;
        };
      };
      sessions: {
        title: string;
        intro: string;
        current: string;
        lastSeen: string;
        close: string;
        closeOthers: string;
        closed: string;
      };
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
      /**
       * El cobro por SINPE. No hay pasarela adonde mandar a nadie: hay un
       * número, un importe exacto y un código que escribir en el detalle.
       */
      paySinpe: string;
      sinpeHow: string;
      sinpeTo: string;
      sinpeAmount: string;
      sinpeCode: string;
      sinpeNoPhone: string;
    };
    /** Los números de WhatsApp de la oficina, y la cola de envíos. */
    whatsapp: {
      heading: string;
      hint: string;
      /** Lo que puede costar automatizar un número. Se dice, no se esconde. */
      warning: string;
      nameLabel: string;
      add: string;
      empty: string;
      connect: string;
      scan: string;
      refresh: string;
      disconnect: string;
      remove: string;
      makeDefault: string;
      isDefault: string;
      capLabel: string;
      sentToday: string;
      queued: string;
      states: Record<'pending' | 'qr' | 'connected' | 'disconnected', string>;
      gatewayDown: string;
      sendHeading: string;
      sendHint: string;
      send: string;
      queuedCount: string;
      queuedDone: string;
      noConnection: string;
      /** La cuenta no pertenece a ninguna oficina: no hay dónde guardar nada. */
      noOffice: string;
      duplicate: string;
      frozen: string;
      /** Se pulsó conectar y el código todavía no ha llegado de WhatsApp. */
      waiting: string;
      /** Se pidió el código y nadie lo escaneó: la espera se da por muerta. */
      expired: string;
      /** Sale del marco del código y devuelve la pantalla entera al panel. */
      continueHere: string;
      /** Cuándo sale la tanda. Vacío es «ahora». */
      scheduleLabel: string;
      /** Lleva `{zone}`. */
      scheduleHint: string;
      /** Lleva `{when}`, y el número en formas de plural. */
      scheduledFor: PluralForms;
      cancelScheduled: string;
      /** El recordatorio a quien no ha contestado. */
      reminderLabel: string;
      reminderOff: string;
      /**
       * «3 días antes». Con formas de plural: «1 días antes» en español y
       * «قبل 1 أيام» en árabe son las dos maneras de que se note que esto lo
       * escribió una máquina.
       */
      reminderDays: PluralForms;
      reminderHint: string;
      /** Las que se rindieron. El número, en formas de plural. */
      failedTitle: PluralForms;
      retry: string;
      retryAll: string;
      failedHint: string;
      /** WhatsApp lo aceptó y el repartidor se cayó: ni salió ni no salió. */
      unsure: string;
      /** Los tres pasos hasta el código. Sin esto, la pantalla no dice cómo. */
      stepsTitle: string;
      step1: string;
      step2: string;
      step3: string;
      advanced: string;
    };
    /** Vender un paquete de invitaciones para UNA boda. */
    packages: {
      heading: string;
      hint: string;
      clientLabel: string;
      clientPhoneLabel: string;
      packageLabel: string;
      sell: string;
      sold: string;
      noneSold: string;
      guestsColumn: string;
      payLink: string;
      sendLink: string;
      created: string;
      allowance: string;
      fromPlan: string;
      fromPackage: string;
      whatsappMessage: string;
      markCash: string;
      markCashDone: string;
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
      imported: PluralForms;
      skipped: PluralForms;
      openedCount: string;
      language: string;
      fallbackWarning: string;
      fallbackFix: string;
      /** Cuando la lista no cabe en lo que el evento tiene pagado. */
      limitTitle: string;
      limitDetail: string;
      limitHint: string;
    };
    /**
     * El cobro por SINPE Móvil: los buzones de banco y lo leído de ellos.
     *
     * No hay pasarela detrás, así que esta pantalla es donde se ve si el dinero
     * está entrando — y sobre todo, si un buzón dejó de conectar.
     */
    sinpe: {
      heading: string;
      intro: string;
      accounts: string;
      accountsEmpty: string;
      add: string;
      name: string;
      nameHint: string;
      bank: string;
      phone: string;
      imapHost: string;
      imapPort: string;
      imapUser: string;
      imapPassword: string;
      imapPasswordHint: string;
      folder: string;
      verifyCertificate: string;
      verifyCertificateHint: string;
      active: string;
      forSubscriptions: string;
      platform: string;
      lastChecked: string;
      never: string;
      lastError: string;
      remove: string;
      movements: string;
      movementsEmpty: string;
      sender: string;
      amount: string;
      reference: string;
      detail: string;
      received: string;
      states: { pending: string; applied: string; ignored: string };
      assign: string;
      assignHint: string;
      assignNone: string;
      assigned: string;
      assignFailed: string;
      paste: string;
      pasteHint: string;
      pasteSubject: string;
      pasteFrom: string;
      pasteBody: string;
      pasteAccount: string;
      pasteButton: string;
      readOk: string;
      readApplied: string;
      readDuplicate: string;
      readOutgoing: string;
      readAccountNotice: string;
      readNotANotice: string;
      payCode: string;
      payCodeHint: string;
    };
    /** El reparto del salón: qué mesas hay y quién se sienta en cada una. */
    tables: {
      heading: string;
      intro: string;
      link: string;
      back: string;
      add: string;
      namePlaceholder: string;
      seatsLabel: string;
      /** Con qué se nombra sola una mesa nueva: «Mesa 1», «Mesa 2»… */
      prefix: string;
      empty: string;
      occupancy: string;
      overflow: string;
      /** Sentado y que ya no viene: se avisa, no se le quita el sitio. */
      ghost: string;
      unseated: string;
      unseatedEmpty: string;
      noTable: string;
      seatedNobody: string;
      autoSeat: string;
      autoSeatHint: string;
      clear: string;
      print: string;
      printByTable: string;
      printByGuest: string;
      printHint: string;
      balance: string;
      duplicate: string;
      notFound: string;
      seatedCount: PluralForms;
      movedCount: PluralForms;
      clearedCount: PluralForms;
    };
    acts: {
      heading: string;
      intro: string;
      link: string;
      back: string;
      add: string;
      edit: string;
      remove: string;
      moveUp: string;
      moveDown: string;
      main: string;
      mainHint: string;
      empty: string;
      labelLabel: string;
      labelPlaceholder: string;
      typeLabel: string;
      dateLabel: string;
      timeLabel: string;
      endTimeLabel: string;
      timezoneLabel: string;
      venueNameLabel: string;
      venueAddressLabel: string;
      venueMapLabel: string;
      capacityLabel: string;
      capacityHint: string;
      optionalLabel: string;
      rsvpLabel: string;
      deadlineLabel: string;
      visibilityLabel: string;
      visibilityPublic: string;
      visibilitySegmented: string;
      visibilityHint: string;
      audienceHeading: string;
      audienceAllow: string;
      audienceDeny: string;
      audienceNone: string;
      audienceHint: string;
      counts: string;
      reportCounts: string;
      reportPending: string;
      reportOver: string;
      exportAct: string;
      coverageHeading: string;
      coverageNoAct: string;
      coverageUnreachable: string;
      coverageSilent: string;
      coverageOpened: string;
      coverageClean: string;
      coverageSample: string;
      segmentsHeading: string;
      segmentsIntro: string;
      segmentAdd: string;
      segmentNameLabel: string;
      segmentMembers: string;
      segmentFill: string;
      segmentRemove: string;
      segmentEmpty: string;
      translationsOpen: string;
      translationsHint: string;
      translationLabel: string;
      translationDescription: string;
      translationVenue: string;
      translationSave: string;
      translationEmpty: string;
      membersOpen: string;
      membersSave: string;
      membersSaved: string;
      membersEmpty: string;
      previewHeading: string;
      previewIntro: string;
      previewGuest: string;
      previewShow: string;
      previewNothing: string;
      previewMaxParty: string;
      previewClosed: string;
      previewReplied: string;
      previewPending: string;
      problems: {
        type: string;
        date: string;
        time: string;
        endTime: string;
        venue: string;
        capacity: string;
        deadline: string;
        notFound: string;
        lastOne: string;
      };
    };
    gate: {
      heading: string;
      link: string;
      back: string;
      intro: string;
      actLabel: string;
      codeLabel: string;
      peopleLabel: string;
      gateLabel: string;
      submit: string;
      inside: string;
      listIn: string;
      listPending: string;
      empty: string;
      undo: string;
      codes: string;
      codesHint: string;
      codesNobody: string;
      print: string;
      ok: string;
      errors: {
        bad_code: string;
        not_invited: string;
        too_many: string;
        already_checked_in: string;
      };
    };
    preferences: {
      heading: string;
      link: string;
      back: string;
      intro: string;
      actLabel: string;
      wholeEvent: string;
      show: string;
      answered: string;
      empty: string;
      people: string;
    };
    campaigns: {
      heading: string;
      link: string;
      back: string;
      intro: string;
      actLabel: string;
      wholeEvent: string;
      segmentLabel: string;
      everyone: string;
      connectionLabel: string;
      preview: string;
      send: string;
      willReach: string;
      excluded: string;
      reasons: {
        not_authorized: string;
        no_phone: string;
        no_consent: string;
        opted_out: string;
        already_sent: string;
      };
      empty: string;
      results: string;
    };
    consent: {
      heading: string;
      link: string;
      back: string;
      intro: string;
      withConsent: string;
      optedOut: string;
      without: string;
      grant: string;
      revoke: string;
      optOut: string;
      purposeLabel: string;
      channelLabel: string;
      sourceLabel: string;
      sourcePlaceholder: string;
      purposes: {
        invitation: string;
        reminder: string;
        marketing: string;
      };
      channels: {
        whatsapp: string;
        email: string;
        sms: string;
      };
      warning: string;
      empty: string;
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
      /** How many guests are waiting for a language nobody has written yet. */
      waiting: PluralForms;
      waitingNone: string;
      pending: PluralForms;
    };
    events: {
      heading: string;
      /** The one thing an office signs in to do. */
      create: string;
      createHint: string;
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
