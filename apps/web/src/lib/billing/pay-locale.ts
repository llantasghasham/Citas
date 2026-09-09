import { LOCALES, type Locale } from '@citas/core';

import type { PublicOrder } from './checkout';

/**
 * En qué idioma se le habla a quien paga.
 *
 * La pareja no tiene cuenta ni preferencia guardada, así que el mejor indicio
 * es el idioma en que se escribió su propia invitación: quien pidió su boda en
 * árabe no quiere leer su factura en español. Si aún no hay invitación, manda
 * el idioma de la oficina. `?lang=` gana siempre, por si la pareja lee otro.
 *
 * Vive aparte de la pantalla porque el layout raíz también lo necesita, para
 * poner `<html lang>` y `<html dir>` sin ver los parámetros de la página.
 */
export function resolvePayLocale(order: PublicOrder | null, requested?: string): Locale {
  const asked = LOCALES.find((candidate) => candidate === requested);
  if (asked !== undefined) return asked;

  return order?.eventLocale ?? order?.officeLocale ?? 'ar';
}
