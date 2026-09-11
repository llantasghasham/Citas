import { FAQ_KEYS, FEATURE_KEYS, PLAN_KEYS, type FaqKey, type FeatureKey, type Locale, type PlanKey } from '@/lib/types';

/**
 * The public site, as configuration.
 *
 * Two things are kept apart on purpose:
 *
 * - WHAT the home page shows — which blocks, which selling points, which
 *   plans, where the buttons go — is decided here, in one file.
 * - WHAT it says is decided in `packages/core/locales/{ar,es,pt,en}.json`,
 *   under `home`, because every word on this platform exists in four
 *   languages and none of them belongs in a component.
 *
 * So: to reorder or hide a block, edit this file. To reword one, edit the four
 * locale files. Neither ever means editing a component.
 */
export interface SiteConfig {
  /** Shown in the header and the footer. Not translated: it is a name. */
  brand: string;
  /** Used when the visitor's browser asks for a language we do not publish. */
  defaultLocale: Locale;
  /** Where the buttons lead. */
  routes: {
    create: string;
    signIn: string;
    examples: string;
  };
  /**
   * Left blank on purpose: an invented phone number on a live site is worse
   * than none. `whatsapp` is in E.164 without the plus (`96170123456`).
   */
  contact: {
    whatsapp: string | null;
    email: string | null;
  };
  /** Blocks, in the order they appear. Drop one from the list to hide it. */
  sections: readonly SectionKey[];
  /** Which selling points, and in which order. */
  features: readonly FeatureKey[];
  /** Which questions, and in which order. */
  faq: readonly FaqKey[];
  /** Which plans the price table shows. */
  plans: readonly PlanKey[];
  /**
   * The invitations the public site may show, by slug.
   *
   * An allow-list, never "everything published": the database holds real
   * clients' weddings, with their names, their date and their address, and a
   * listing that is not filtered by office would put them on the front door.
   * Each slug here is resolved one by one — a public slug lookup is the
   * product's single deliberate tenant-free query.
   */
  showcase: readonly string[];
}

export const SECTION_KEYS = ['features', 'steps', 'showcase', 'pricing', 'faq', 'closing'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * La marca que trae de fábrica, dibujada a mano en `public/brand`.
 *
 * Va aparte de `SiteConfig` porque no es un ajuste con tres capas como los
 * demás: es el último recurso. Una instalación recién levantada enseñaba el
 * nombre en texto pelado y una pestaña en blanco, y parecía a medio terminar
 * antes de que nadie hubiera hecho nada mal.
 *
 * Quien monta lo suyo lo tapa subiendo el suyo, que es lo que manda. Y quitar
 * el suyo vuelve AQUÍ, no a nada: una cabecera sin marca no es un estado que
 * nadie quiera dejar puesto.
 */
/**
 * El SELLO, no el logotipo con el nombre dentro.
 *
 * `logo.png` lleva la palabra «Citas» escrita en crema, y eso venía de dar por
 * buena una cosa que no lo era: la cabecera del PANEL es crema, no oscura. Ahí
 * el nombre del logotipo se volvía invisible y solo se veía el arco — y al lado,
 * en texto, «Citas» otra vez. Dos veces el nombre, una de ellas borrada.
 *
 * El sello es cuadrado, se lee sobre claro y sobre oscuro, y deja que el nombre
 * lo ponga el texto de al lado UNA vez. Que es además lo correcto cuando una
 * oficina pone el suyo: lo que se enseña es el nombre de la oficina.
 */
export const DEFAULT_LOGO = '/brand/mark.svg';
export const DEFAULT_ICON = '/brand/icon.png';

export const SITE: SiteConfig = {
  brand: 'Citas',
  defaultLocale: 'ar',
  routes: {
    create: '/crear',
    signIn: '/entrar',
    examples: '/ejemplos',
  },
  contact: {
    whatsapp: null,
    email: null,
  },
  sections: SECTION_KEYS,
  features: FEATURE_KEYS,
  faq: FAQ_KEYS,
  plans: PLAN_KEYS,
  showcase: ['ejemplo-ar', 'ejemplo-memorial', 'ejemplo-es', 'ejemplo-en', 'ejemplo-pt'],
};

/** True when the block is switched on in the configuration above. */
export function shows(section: SectionKey): boolean {
  return SITE.sections.includes(section);
}
