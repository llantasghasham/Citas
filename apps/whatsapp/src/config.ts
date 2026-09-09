import { readFileSync } from 'node:fs';

/**
 * Lo que este servicio necesita para arrancar, y nada más.
 *
 * Va por entorno y no por la tabla `Setting` a propósito: esto es un proceso
 * aparte que arranca solo, y lo que hace falta para leer la base de datos no
 * puede vivir dentro de la base de datos.
 */
export interface GatewayConfig {
  databaseUrl: string;
  /** El secreto compartido con la web. Sin él, cualquiera manda mensajes. */
  token: string;
  port: number;
  /** Segundos entre mensajes, mínimo y máximo. El azar entre medias. */
  delayMin: number;
  delayMax: number;
  /** Cuántos mensajes manda un número nuevo el primer día. */
  warmupCap: number;
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
    delayMin: number('WHATSAPP_DELAY_MIN', 8),
    delayMax: number('WHATSAPP_DELAY_MAX', 25),
    warmupCap: number('WHATSAPP_WARMUP_CAP', 20),
  };
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
