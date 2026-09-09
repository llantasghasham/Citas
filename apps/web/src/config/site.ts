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
  /** How many published invitations the showcase may display. */
  showcaseLimit: number;
}

export const SECTION_KEYS = ['features', 'steps', 'showcase', 'pricing', 'faq', 'closing'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

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
  showcaseLimit: 3,
};

/** True when the block is switched on in the configuration above. */
export function shows(section: SectionKey): boolean {
  return SITE.sections.includes(section);
}
