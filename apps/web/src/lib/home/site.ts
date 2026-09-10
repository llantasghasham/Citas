import { cache } from 'react';

import {
  DEFAULT_ICON,
  DEFAULT_LOGO,
  SITE,
  SECTION_KEYS,
  type SectionKey,
  type SiteConfig,
} from '@/config/site';
import { brandAssetSrc, brandVersions } from '@/lib/brand/assets';
import { setting } from '@/lib/settings';
import { FAQ_KEYS, FEATURE_KEYS, PLAN_KEYS, LOCALES, type Locale } from '@/lib/types';

/**
 * La portada, ya resuelta: los valores de `config/site.ts` con lo guardado en
 * el panel encima.
 *
 * El archivo deja de ser «la configuración» y pasa a ser «lo que trae de
 * fábrica». Quien monta el sistema cambia el nombre, el logo, los bloques y las
 * invitaciones de muestra desde `/panel/configuracion`, sin desplegar.
 *
 * Nada de lo guardado se cree sin comprobar: una lista de bloques se filtra
 * contra los que existen, y una de invitaciones se limita a diez. Estas filas
 * las escribe el superadministrador, no un visitante, pero una fila vieja de
 * una versión anterior no debe poder romper la portada.
 */
export interface ResolvedSite extends SiteConfig {
  /** Logo de la cabecera. Vacío cuando no hay: entonces se escribe el nombre. */
  logoUrl: string | null;
  /** El icono de la pestaña del navegador. */
  iconUrl: string | null;
}

/** Una lista separada por comas, filtrada contra lo que de verdad existe. */
function list<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | null {
  if (raw === undefined) return null;
  const chosen = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is T => allowed.includes(entry as T));
  return chosen.length === 0 ? null : chosen;
}

export const loadSite = cache(async (): Promise<ResolvedSite> => {
  const [name, logo, icon, whatsapp, email, sections, showcase, defaultLocale, uploaded] =
    await Promise.all([
      setting('BRAND_NAME'),
      setting('BRAND_LOGO_URL'),
      setting('BRAND_ICON_URL'),
      setting('CONTACT_WHATSAPP'),
      setting('CONTACT_EMAIL'),
      setting('HOME_SECTIONS'),
      setting('HOME_SHOWCASE'),
      setting('HOME_DEFAULT_LOCALE'),
      brandVersions(),
    ]);

  const chosenLocale = LOCALES.find((candidate) => candidate === defaultLocale);

  return {
    ...SITE,
    brand: name ?? SITE.brand,
    // Manda lo SUBIDO. La dirección se sigue leyendo porque hay instalaciones
    // que ya la tienen puesta, y quitarles el logo por cambiar de forma de
    // guardarlo sería cobrárselo a quien no pidió nada.
    logoUrl: brandAssetSrc('logo', uploaded.logo) ?? logo ?? DEFAULT_LOGO,
    iconUrl: brandAssetSrc('icon', uploaded.icon) ?? icon ?? DEFAULT_ICON,
    defaultLocale: chosenLocale ?? SITE.defaultLocale,
    contact: {
      // Sin número inventado: lo que no está puesto no sale.
      whatsapp: whatsapp ?? SITE.contact.whatsapp,
      email: email ?? SITE.contact.email,
    },
    sections: list<SectionKey>(sections, SECTION_KEYS) ?? SITE.sections,
    showcase:
      showcase === undefined
        ? SITE.showcase
        : showcase
            .split(',')
            .map((slug) => slug.trim())
            .filter((slug) => slug.length > 0)
            .slice(0, 10),
    features: FEATURE_KEYS,
    faq: FAQ_KEYS,
    plans: PLAN_KEYS,
  };
});

/** True cuando el bloque está encendido en la configuración resuelta. */
export function showsIn(site: ResolvedSite, section: SectionKey): boolean {
  return site.sections.includes(section);
}

export type { SectionKey, Locale };
