/**
 * El portal público del directorio habla CINCO idiomas, y el producto sigue
 * hablando cuatro.
 *
 * No es un capricho de organización: `Locale` —el del producto— está en el enum
 * de Prisma, en `types.ts` y en cada `Record<Locale, …>` del repositorio, y el
 * tipo `Dictionary` exige todas las claves de todos los idiomas. Meter `fr` ahí
 * obligaría a traducir al francés el panel entero, el manual de veintidós
 * capítulos, los correos y la app móvil: unas mil cuatrocientas frases, para
 * poder publicar un salón.
 *
 * Así que son dos conjuntos. El portal nace con francés —que en Líbano hace
 * falta— y su diccionario lleva SOLO sus frases. Si algún día se quiere el
 * producto entero en francés, es un trabajo aparte y esto no lo estorba.
 */
export const DIRECTORY_LOCALES = ['ar', 'en', 'fr', 'es', 'pt'] as const;
export type DirectoryLocale = (typeof DIRECTORY_LOCALES)[number];

export function isDirectoryLocale(value: string): value is DirectoryLocale {
  return (DIRECTORY_LOCALES as readonly string[]).includes(value);
}

/** El árabe es el único que se escribe de derecha a izquierda. */
export function directoryDirection(locale: DirectoryLocale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Los nombres de las categorías y de las regiones.
 *
 * Las CLAVES son las mismas que la lista cerrada del servidor
 * (`lib/directory/categories.ts`): lo que se guarda es el código y lo que lee
 * una persona sale de aquí. Añadir una categoría es tocar los dos sitios, y el
 * tipo obliga a traducirla en los cinco idiomas antes de que compile.
 */
export interface DirectoryDictionary {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    home: string;
    providers: string;
    parties: string;
    search: string;
  };
  home: {
    title: string;
    subtitle: string;
    browseByCategory: string;
    browseByRegion: string;
    featured: string;
    empty: string;
  };
  search: {
    placeholder: string;
    category: string;
    governorate: string;
    district: string;
    city: string;
    anyCategory: string;
    anyRegion: string;
    submit: string;
    results: string;
    none: string;
  };
  provider: {
    verified: string;
    since: string;
    capacity: string;
    priceFrom: string;
    services: string;
    contact: string;
    gallery: string;
    video: string;
    location: string;
    report: string;
    noDescription: string;
  };
  report: {
    title: string;
    intro: string;
    reason: string;
    message: string;
    email: string;
    emailRequired: string;
    submit: string;
    thanks: string;
    tooMany: string;
    reasons: {
      false_info: string;
      scam: string;
      offensive: string;
      wrong_number: string;
      closed: string;
      copyright: string;
    };
  };
  channels: {
    phone: string;
    whatsapp: string;
    email: string;
    website: string;
    instagram: string;
    facebook: string;
    tiktok: string;
  };
  groups: {
    venue: string;
    food: string;
    music: string;
    decor: string;
    rental: string;
    media: string;
    services: string;
  };
  categories: Record<string, string>;
  governorates: Record<string, string>;
  districts: Record<string, string>;
  /**
   * El panel del proveedor.
   *
   * Va en el diccionario del PORTAL y no en el del producto por la misma razón
   * que el portal: quien administra un salón en Líbano puede querer el francés,
   * y el panel de una oficina no lo habla. Las etiquetas de las categorías, las
   * regiones y los canales se reutilizan de arriba — son las mismas palabras y
   * traducirlas dos veces es como acaban diciendo cosas distintas.
   */
  panel: {
    title: string;
    profile: string;
    media: string;
    state: string;
    signOut: string;

    legalName: string;
    legalNameHelp: string;
    mainLocale: string;
    city: string;
    address: string;
    addressHelp: string;
    capacity: string;
    year: string;
    save: string;
    saved: string;

    translationsTitle: string;
    translationsHelp: string;
    name: string;
    tagline: string;
    description: string;
    servicesHelp: string;

    categoriesTitle: string;
    categoriesHelp: string;
    primary: string;

    contactsTitle: string;
    contactsHelp: string;
    public: string;

    mediaHelp: string;
    upload: string;
    remove: string;
    up: string;
    down: string;
    altText: string;
    videoUrl: string;
    videoHelp: string;
    slotsLeft: string;

    statusDraft: string;
    statusPending: string;
    statusApproved: string;
    statusRejected: string;
    statusSuspended: string;
    statusHidden: string;
    submit: string;
    submitHelp: string;
    rejectedNote: string;
    reviewClock: string;

    newTitle: string;
    newHelp: string;
    create: string;
    noProvider: string;

    errors: {
      name: string;
      governorate: string;
      district: string;
      city: string;
      category: string;
      tooManyCategories: string;
      channel: string;
      notFound: string;
      notDraft: string;
      tooMany: string;
      tooBig: string;
      notAnImage: string;
      tooSmall: string;
      tooManyPixels: string;
      badVideo: string;
    };
  };

  /**
   * La moderación. Va aquí y no en el diccionario del producto porque son las
   * palabras de este módulo, y las de estado ya están escritas arriba.
   */
  moderation: {
    title: string;
    queue: string;
    mediaQueue: string;
    empty: string;
    waiting: string;
    overdue: string;
    hoursLeft: string;
    review: string;
    approve: string;
    reject: string;
    suspend: string;
    restore: string;
    verify: string;
    unverify: string;
    hide: string;
    purge: string;
    purgeHelp: string;
    note: string;
    noteRequired: string;
    history: string;
    images: string;
    languages: string;
  };
}
