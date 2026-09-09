import { cache } from 'react';

import { getDictionary, LOCALES, type Dictionary, type Locale } from '@citas/core';

import { settingsWithPrefix } from './index';

/**
 * Los textos de la portada, editables desde el panel.
 *
 * La regla del proyecto sigue en pie: cero cadenas en los componentes, y lo
 * escrito vive en los cuatro diccionarios. Lo que se añade aquí es una CAPA
 * ENCIMA de esos diccionarios, no un sustituto: el diccionario es el valor por
 * defecto y lo que se guarda en el panel lo tapa.
 *
 * Por qué así y no con una columna por texto: la portada tiene cerca de sesenta
 * frases, y son cuatro idiomas. Doscientas cuarenta columnas no son un esquema.
 * Cada texto se guarda con la ruta que ya tiene dentro del diccionario más el
 * idioma —`home.hero.subtitle.ar`—, así que la pantalla de configuración se
 * genera SOLA a partir del diccionario y nunca se queda desfasada: se añade una
 * frase a los cuatro idiomas y aparece sin tocar la pantalla.
 *
 * Vacío significa «vuelve al valor por defecto». No hay forma de dejar un texto
 * en blanco a propósito, y es deliberado: una portada con huecos es un error
 * más caro que una portada con la frase original.
 */
export const HOME_PREFIX = 'home.';

/** Un texto de la portada: su ruta dentro del bloque `home` y lo que dice. */
export interface HomeText {
  /** `hero.subtitle`, `faq.items.payment.answer`… */
  path: string;
  /** Lo que dice hoy, sea del panel o del diccionario. */
  value: string;
  /** Lo que diría si nadie lo hubiera tocado. */
  fallback: string;
  /** True cuando alguien lo escribió en el panel. */
  overridden: boolean;
}

/** Cada hoja de texto del bloque `home`, con su ruta. Ordenadas como el JSON. */
function leaves(node: unknown, prefix = ''): { path: string; value: string }[] {
  if (typeof node === 'string') return [{ path: prefix, value: node }];
  if (typeof node !== 'object' || node === null) return [];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
}

export function homePaths(): string[] {
  // El diccionario español como referencia de la forma: los cuatro tienen las
  // mismas claves, y el tipo `Dictionary` lo obliga.
  return leaves(getDictionary('es').home).map((leaf) => leaf.path);
}

/** Todo lo que puede editarse de la portada en un idioma, con su valor de hoy. */
export async function homeTexts(locale: Locale): Promise<HomeText[]> {
  const saved = await settingsWithPrefix(HOME_PREFIX);
  const defaults = leaves(getDictionary(locale).home);

  return defaults.map((leaf) => {
    const stored = saved.get(`${HOME_PREFIX}${leaf.path}.${locale}`);
    return {
      path: leaf.path,
      value: stored ?? leaf.value,
      fallback: leaf.value,
      overridden: stored !== undefined,
    };
  });
}

/**
 * El bloque `home` del diccionario con lo del panel ya encima.
 *
 * Memorizado por petición: la portada lo pide una vez y el layout otra.
 */
export const homeCopy = cache(
  async (locale: Locale): Promise<Dictionary['home']> => {
    const saved = await settingsWithPrefix(HOME_PREFIX);
    const base = getDictionary(locale).home;
    if (saved.size === 0) return base;

    // Copia profunda antes de escribir: el diccionario es un módulo compartido
    // por todas las peticiones del proceso, y taparlo en su sitio le cambiaría
    // la portada a todo el mundo.
    const merged = structuredClone(base) as Record<string, unknown>;
    const suffix = `.${locale}`;

    for (const [key, value] of saved) {
      if (!key.endsWith(suffix)) continue;
      const path = key.slice(HOME_PREFIX.length, -suffix.length);
      setAt(merged, path.split('.'), value);
    }

    return merged as Dictionary['home'];
  },
);

/** Escribe en `hero.subtitle` sin crear ramas que el diccionario no tenga. */
function setAt(target: Record<string, unknown>, path: string[], value: string): void {
  const last = path[path.length - 1];
  if (last === undefined) return;

  let node: Record<string, unknown> = target;
  for (const step of path.slice(0, -1)) {
    const next = node[step];
    // Una ruta que el diccionario no tiene se ignora: si sobrevive una fila de
    // una versión anterior, no debe inventar un campo que nadie lee.
    if (typeof next !== 'object' || next === null) return;
    node = next as Record<string, unknown>;
  }
  if (typeof node[last] === 'string') node[last] = value;
}

export function isLocale(value: string): value is Locale {
  return LOCALES.some((candidate) => candidate === value);
}
