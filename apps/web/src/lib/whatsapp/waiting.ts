import type { WhatsappStatus } from '@/generated/prisma/enums';

/**
 * Cuándo un número está esperando el código DE VERDAD.
 *
 * Esto existe por un fallo con nombre y apellidos. La pantalla se refrescaba
 * sola mientras el estado fuera `qr`, y un `qr` no caduca solo: si el servicio
 * se cae, o el número se conecta desde otro sitio, la fila se queda en `qr`
 * para siempre. A partir de ahí, CADA visita a la pantalla de WhatsApp armaba
 * una recarga automática eterna, y el temporizador de esa recarga se lo lleva
 * el navegador consigo aunque se salga de la pantalla: entrar al perfil y verse
 * devuelto a WhatsApp cinco segundos después.
 *
 * Un código de WhatsApp vive veinte segundos y el servicio emite el siguiente,
 * tocando la fila cada vez. Si nadie la ha tocado en dos minutos, ahí no está
 * pasando nada: se deja de esperar y se dice que caducó.
 */
const STALE_AFTER_MS = 2 * 60 * 1000;

export interface WaitingInput {
  id: string;
  status: WhatsappStatus;
  updatedAt: Date;
}

/**
 * `pending` solo cuenta si es el número al que se le acaba de dar a Conectar.
 * Uno recién añadido también está `pending`, y ahí nadie ha pedido nada
 * todavía: decirle «pidiendo el código» sería mentirle.
 */
export function isWaiting(row: WaitingInput, esperando?: string): boolean {
  if (!isFresh(row)) return false;
  if (row.status === 'qr') return true;
  return row.status === 'pending' && esperando === row.id;
}

/**
 * Se pidió el código y se quedó sin llegar. Solo se dice de quien estaba
 * esperando: un número sin conectar al que nadie ha tocado no ha caducado nada.
 */
export function hasExpired(row: WaitingInput, esperando?: string): boolean {
  if (isFresh(row)) return false;
  return row.status === 'qr' || (row.status === 'pending' && esperando === row.id);
}

function isFresh(row: WaitingInput): boolean {
  return Date.now() - row.updatedAt.getTime() < STALE_AFTER_MS;
}
