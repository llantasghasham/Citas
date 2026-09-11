import { setting } from '@/lib/settings';

/**
 * Los planes, en colones.
 *
 * Están escritos en dólares —el mercado de salida es Líbano— y el SINPE solo
 * mueve colones, así que hay que convertirlos. El tipo de cambio NO se codifica
 * aquí: se edita en `/panel/configuracion?s=payments`, porque un número metido
 * en el código envejece solo y el día que lo haga nadie va a acordarse de dónde
 * estaba. Lo de fábrica es una cifra razonable para Costa Rica, no un dato de
 * mercado, y quien cobra tiene que ponerlo.
 */

/** Lo que trae de fábrica, hasta que alguien lo ponga bien. */
export const DEFAULT_CRC_PER_USD = 500;

/**
 * A cuántos céntimos de colón hay que redondear.
 *
 * Cien colones. El importe lo teclea una persona en el móvil y tiene que
 * coincidir EXACTO con lo que se espera, así que «₡7.500» se escribe sin error
 * y «₡7.483,50» se escribe mal. Redondear hacia ARRIBA, además: lo contrario
 * es regalar unos colones en cada cobro, y una diferencia hacia abajo es un
 * pago que no casa.
 */
const STEP = 100 * 100;

export async function crcPerUsd(): Promise<number> {
  const raw = await setting('CRC_PER_USD');
  const parsed = Number.parseFloat((raw ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CRC_PER_USD;
  // Un tipo absurdo escrito de más en un campo de texto no puede multiplicar
  // por mil el precio de un plan.
  return Math.min(5000, Math.max(1, parsed));
}

/** Céntimos de dólar → céntimos de colón, redondeados hacia arriba a ₡100. */
export function usdCentsToCrc(usdCents: number, rate: number): number {
  const exact = usdCents * rate;
  return Math.ceil(exact / STEP) * STEP;
}

export async function planPriceInCrc(usdCents: number): Promise<number> {
  return usdCentsToCrc(usdCents, await crcPerUsd());
}
