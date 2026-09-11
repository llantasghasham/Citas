import { createHash } from 'node:crypto';

/**
 * Los frenos del extremo por el que entra un aviso de cobro.
 *
 * Ese extremo es PÚBLICO y no va firmado —el contrato de Whish, hasta donde se
 * ha podido confirmar, no ofrece firma ni HMAC— así que cualquiera en internet
 * puede llamarlo tantas veces como quiera. Que no pueda cobrar nada ya está
 * resuelto: nada del cuerpo decide, se le pregunta al proveedor y
 * `applySettlement` es idempotente.
 *
 * Lo que faltaba es lo OTRO: que llamarlo mil veces no cueste mil consultas a
 * la pasarela ni mil filas en el historial. Tres frenos, y ninguno decide sobre
 * dinero:
 *
 *  1. El cuerpo tiene un tope. Un aviso de cobro son unos cientos de bytes.
 *  2. Una misma dirección tiene un cupo por minuto.
 *  3. El MISMO aviso repetido no se vuelve a tramitar durante un rato.
 *
 * Los dos últimos viven en memoria del proceso, y se dice a propósito: con
 * varios procesos cada uno lleva su cuenta. Es un freno, no una cerradura — la
 * cerradura es que el aviso no decide nada.
 */

/** Un aviso de cobro son unos cientos de bytes. Diez kilobytes es de sobra. */
export const MAX_CALLBACK_BYTES = 10 * 1024;

/** Cuántos avisos por minuto se atienden desde una misma dirección. */
const PER_MINUTE = 60;
const WINDOW_MS = 60_000;

/** Cuánto se recuerda un aviso ya tramitado para no repetir el trabajo. */
const REPLAY_MS = 60_000;

const hits = new Map<string, { count: number; until: number }>();
const seen = new Map<string, number>();

/** Que quepa. Se mira la cabecera ANTES de leer el cuerpo. */
export function tooLarge(headers: Headers, body?: string): boolean {
  const declared = Number.parseInt(headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_CALLBACK_BYTES) return true;
  return body !== undefined && Buffer.byteLength(body, 'utf8') > MAX_CALLBACK_BYTES;
}

/** Si esta dirección se pasó de cupo. */
export function rateLimited(key: string, now = Date.now()): boolean {
  sweep(hits, now);
  const entry = hits.get(key);
  if (entry === undefined || entry.until <= now) {
    hits.set(key, { count: 1, until: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > PER_MINUTE;
}

/**
 * Si este MISMO aviso ya se tramitó hace nada.
 *
 * La huella es el proveedor y el cuerpo entero: dos avisos distintos del mismo
 * cobro —«pendiente» y luego «pagado»— tienen cuerpos distintos y los dos se
 * tramitan. Lo que se corta es el mismo byte a byte, repetido.
 */
export function alreadySeen(provider: string, body: string, now = Date.now()): boolean {
  sweepSeen(now);
  const key = `${provider}:${createHash('sha256').update(body).digest('hex')}`;
  const until = seen.get(key);
  if (until !== undefined && until > now) return true;
  seen.set(key, now + REPLAY_MS);
  return false;
}

function sweep(map: Map<string, { until: number }>, now: number): void {
  if (map.size < 1000) return;
  for (const [key, entry] of map) if (entry.until <= now) map.delete(key);
}

function sweepSeen(now: number): void {
  if (seen.size < 1000) return;
  for (const [key, until] of seen) if (until <= now) seen.delete(key);
}

/** Para las pruebas: empezar de cero. */
export function resetCallbackGuards(): void {
  hits.clear();
  seen.clear();
}
