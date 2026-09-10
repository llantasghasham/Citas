/**
 * Deja un correo de banco en texto plano antes de buscarle nada.
 *
 * Hay bancos —Davivienda -— que mandan SOLO HTML, y sin limpiarlo el sistema
 * inventa dinero. Ya pasó dos veces, y las dos con la misma causa:
 *
 *  - El monto salía del CSS. Un `style="width:402.812px"` daba ₡402.812 en
 *    TODOS los correos, siempre el mismo, porque la hoja de estilo es la misma.
 *  - La referencia salía «ncia»: el final de la palabra «Referencia», partida
 *    por una etiqueta que quedaba en medio.
 *
 * Por eso el orden importa: `<script>` y `<style>` se van ENTEROS —con su
 * contenido—, y solo después se quitan las demás etiquetas. Y los cierres de
 * fila, celda y párrafo se convierten en salto de línea antes de eso, porque si
 * no «Monto:» se pega a su valor y a lo que venga detrás.
 *
 * Un SMS pegado a mano no trae etiquetas y se deja tal cual: meterle este
 * tratamiento a un texto plano solo puede estropearlo.
 */

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  colon: ':',
  // El símbolo del colón costarricense. Sin esto, un correo que escriba
  // `&cent;25.000` se queda sin marca de moneda y su monto deja de leerse —
  // que es exactamente el fallo seguro: no cobrar de más, no cobrar.
  cent: '¢',
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED[name] ?? match);
}

/** Si el cuerpo trae etiquetas. Un SMS no las trae. */
export function looksLikeHtml(body: string): boolean {
  return /<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i.test(body);
}

export function plainText(body: string): string {
  if (!looksLikeHtml(body)) return normaliseSpace(decodeEntities(body));

  const withoutCode = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = withoutCode
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|td|th|p|div|li|h[1-6]|table|ul|ol)\s*>/gi, '\n');

  return normaliseSpace(decodeEntities(withBreaks.replace(/<[^>]*>/g, ' ')));
}

/** Espacios y líneas en blanco de más, que solo estorban a las expresiones. */
function normaliseSpace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
