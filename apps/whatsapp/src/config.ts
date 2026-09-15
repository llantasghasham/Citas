import { readFileSync } from 'node:fs';

/**
 * Lo que este servicio necesita para ARRANCAR, y nada más.
 *
 * Va por entorno y no por la tabla `Setting` a propósito: esto es un proceso
 * aparte que arranca solo, y lo que hace falta para leer la base de datos no
 * puede vivir dentro de la base de datos. El token, además, lo comparten dos
 * procesos que arrancan por separado.
 *
 * Lo que SÍ se ajusta en caliente —el retardo y el calentamiento— ya no está
 * aquí: vive en `Setting` y se lee en `readTunables()`. La regla del proyecto
 * es que nada que el dueño quiera cambiar exija entrar por SSH, y el retardo
 * es justo lo que va a querer tocar cuando un número vaya apretado.
 */
export interface GatewayConfig {
  databaseUrl: string;
  /** El secreto compartido con la web. Sin él, cualquiera manda mensajes. */
  token: string;
  port: number;
}

/**
 * Los límites del freno, y por qué existen.
 *
 * Se pueden ajustar, pero no anular. Quien monta esto eligió expresamente la
 * versión CON freno sobre la versión sin él, así que un retardo de cero
 * convertiría el sistema en la opción que descartó, sin que nadie lo decidiera.
 * Un mínimo de tres segundos deja margen para ir más rápido y sigue sin
 * parecerse a un bucle.
 *
 * Se recortan al LEER y no solo al guardar: una fila escrita a mano en la base
 * no debe poder quitar el freno.
 */
export const LIMITS = {
  delayMin: { min: 3, max: 300, fallback: 8 },
  delayMax: { min: 3, max: 600, fallback: 25 },
  warmupCap: { min: 1, max: 100, fallback: 20 },
} as const;

export interface Tunables {
  /** Segundos entre mensajes, mínimo y máximo. El azar entre medias. */
  delayMin: number;
  delayMax: number;
  /** Cuántos mensajes manda un número nuevo el primer día. */
  warmupCap: number;
}

export function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Falta ${name}. Este servicio no arranca sin ella.`);
  }
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(): GatewayConfig {
  const token = required('WHATSAPP_GATEWAY_TOKEN');
  if (token.length < 24) {
    // Un secreto corto es un secreto adivinable, y lo que abre es el WhatsApp
    // del cliente. Se para aquí y no cuando alguien lo adivine.
    throw new Error('WHATSAPP_GATEWAY_TOKEN es demasiado corto: al menos 24 caracteres.');
  }

  return {
    databaseUrl: required('DATABASE_URL'),
    token,
    port: number('WHATSAPP_GATEWAY_PORT', 4100),
  };
}

/** Lo mismo, para el respaldo por entorno de los tres ajustables. */
export function fromEnv(name: string, fallback: number): number {
  return number(name, fallback);
}

/**
 * La llave con la que se cifran las credenciales de sesión.
 *
 * La MISMA que usa la web (`CITAS_SECRET_KEY_FILE`), y por la misma razón:
 * fuera de la base de datos. Una sesión de WhatsApp en claro en un volcado deja
 * escribir desde el número del cliente.
 */
export function readKey(): Buffer {
  const inline = process.env['CITAS_SECRET_KEY'];
  const path = process.env['CITAS_SECRET_KEY_FILE'];

  const material =
    inline !== undefined && inline.length > 0
      ? inline
      : path !== undefined && path.length > 0
        ? readFileSync(path, 'utf8')
        : undefined;

  if (material === undefined) {
    throw new Error('Falta la llave de cifrado. Ponga CITAS_SECRET_KEY_FILE.');
  }

  const key = Buffer.from(material.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error('La llave tiene que ser de 32 bytes en base64 (openssl rand -base64 32).');
  }
  return key;
}
