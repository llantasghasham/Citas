import type { Locale } from '@citas/core';

/**
 * Una fecha, escrita para que la lea una persona.
 *
 * Existe porque en tres pantallas se estaba haciendo `toISOString().slice(0,10)`
 * y eso tiene dos defectos a la vez:
 *
 *  1. Es UTC. Una oficina en Costa Rica que vende un paquete a las siete de la
 *     tarde lo ve fechado AL DÍA SIGUIENTE, porque allí son las siete y aquí ya
 *     es medianoche. Discutir una factura con esa fecha delante es feo.
 *  2. Es `2026-03-14`, en el mismo formato para los cuatro idiomas. Nadie
 *     escribe así una fecha en árabe, ni en español.
 *
 * `Intl` sabe las dos cosas y ya viene con el runtime.
 */
export function formatDate(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(value);
}

/** Con la hora, para cuando importa a qué hora pasó. */
export function formatDateTime(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(value);
}
