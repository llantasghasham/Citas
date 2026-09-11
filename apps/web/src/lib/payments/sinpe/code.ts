import { randomInt } from 'node:crypto';

/**
 * El código que quien paga escribe en el detalle del SINPE.
 *
 * Es la pieza que falta para que un SINPE se pueda casar con un cobro. El
 * comprobante del banco no vale: lo inventa el banco al mandar el dinero, así
 * que aquí no se conoce antes de que llegue. Y el monto solo tampoco —dos
 * oficinas con el mismo plan pagan lo mismo el mismo día—, y confundirlas
 * significa activarle el plan a la que no pagó.
 *
 * Se teclea A MANO en el móvil, en una casilla corta, así que:
 *
 *  - Seis caracteres, ni uno más.
 *  - Sin O ni 0, sin I ni 1: en la pantalla de un banco no se distinguen, y
 *    quien lo copia mal no paga — paga y no se le activa nada.
 *  - Al menos dos letras, para que no salga un código de seis dígitos que se
 *    confunda con un trozo de un número de teléfono o de un comprobante.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PAY_CODE_LENGTH = 6;

export function newPayCode(): string {
  const chars: string[] = [];
  for (let index = 0; index < PAY_CODE_LENGTH; index += 1) {
    chars.push(ALPHABET[randomInt(ALPHABET.length)] ?? '2');
  }
  // Al menos dos letras: se sustituyen las dos primeras posiciones que sean
  // dígitos hasta llegar a dos, en vez de tirar el código y empezar de nuevo.
  let letters = chars.filter((char) => LETTERS.includes(char)).length;
  for (let index = 0; index < chars.length && letters < 2; index += 1) {
    if (LETTERS.includes(chars[index] ?? '')) continue;
    chars[index] = LETTERS[randomInt(LETTERS.length)] ?? 'A';
    letters += 1;
  }
  return chars.join('');
}

/**
 * Si el código aparece en el texto del correo.
 *
 * Se busca en el correo ENTERO y no solo en el campo de detalle: cada banco
 * llama a esa casilla de una manera y alguno no la manda por separado. Con
 * límites de palabra, para que un código no se encuentre dentro de otra cosa,
 * y sin distinguir mayúsculas, porque nadie las respeta al teclear.
 */
export function codeAppearsIn(text: string, code: string): boolean {
  if (code.length < 4) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
}
