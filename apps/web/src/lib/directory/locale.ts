import { DIRECTORY_LOCALES, type DirectoryLocale } from '@citas/core';

/**
 * En qué idioma abrir el portal a quien llega a `/d` sin decir cuál.
 *
 * Es lo MISMO que hace la portada con `Accept-Language`. Lo que decide es una
 * CABECERA y el resultado es una REDIRECCIÓN a una dirección propia por idioma,
 * no una página que cambia según quien la pida — eso último es lo que impediría
 * cachearla y lo que haría que un buscador indexara cuatro idiomas bajo la misma
 * dirección.
 *
 * Sin cabecera conocida, árabe: es el idioma principal de este producto y el del
 * mercado.
 */
export function directoryLocaleFrom(acceptLanguage: string): DirectoryLocale {
  const preferred = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', q = 'q=1'] = part.trim().split(';');
      return { tag: tag.trim().toLowerCase(), weight: Number.parseFloat(q.replace('q=', '')) || 0 };
    })
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of preferred) {
    // `ar-LB` y `pt-BR` son la forma normal de esta cabecera: se compara la
    // primera etiqueta, no la entera.
    const primary = tag.split('-')[0];
    const match = DIRECTORY_LOCALES.find((locale) => locale === primary);
    if (match !== undefined) return match;
  }

  return 'ar';
}
