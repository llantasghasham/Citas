import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { readKey } from './config.js';

/**
 * El MISMO formato que usa la web: `v1.<iv>.<tag>.<ciphertext>`, todo base64,
 * AES-256-GCM.
 *
 * Se repite aquí, corto y sin dependencias, en vez de importarlo del paquete
 * web: este servicio no arrastra Next ni Prisma-de-Next solo para cifrar. Lo
 * que no puede cambiar nunca es el formato, porque las dos partes leen las
 * mismas filas.
 */
const FORMAT = 'v1';

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    FORMAT,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decrypt(payload: string): string {
  const [format, iv, tag, ciphertext] = payload.split('.');
  if (format !== FORMAT || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error('Secreto mal formado. Se esperaba v1.<iv>.<tag>.<ciphertext>.');
  }

  const decipher = createDecipheriv('aes-256-gcm', readKey(), Buffer.from(iv, 'base64'));
  // GCM comprueba la etiqueta al cerrar: un valor manipulado revienta en vez de
  // descifrarse en cualquier cosa.
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
