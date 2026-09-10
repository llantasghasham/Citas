/**
 * Lo que cuesta abrir una imagen, y quién paga.
 *
 * Descodificar no es gratis: una imagen de cincuenta megapíxeles ocupa
 * doscientos megas en memoria mientras se abre, venga en un archivo de dos.
 * Ese desajuste —un archivo pequeño que declara un lienzo enorme— es un ataque
 * viejo, y también es lo que pasa sin mala fe cuando alguien sube el escaneo de
 * un cartel.
 *
 * Tres frenos, y los tres hacen falta:
 *
 *  1. El TAMAÑO del archivo, que se mira antes de leerlo.
 *  2. Los PÍXELES al descodificar, que es lo que de verdad cuesta memoria.
 *  3. Cuántas se abren A LA VEZ. Sin esto, cinco personas subiendo su foto a la
 *     vez piden un giga de memoria en el mismo instante, y el que se cae es el
 *     servidor entero.
 *
 * Quien puede llegar aquí tiene sesión: es el personal de una oficina, no
 * internet. Eso baja el riesgo, no lo quita — un descuido de cinco personas
 * basta.
 */

/**
 * Tope de píxeles al descodificar.
 *
 * Cincuenta millones son doscientos megas de memoria en el peor caso, y dejan
 * pasar cualquier foto de teléfono que quepa en los ocho megas de archivo que
 * se aceptan. Estaba en ciento veinte millones, que son casi quinientos.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Cuántas descodificaciones a la vez. Las demás esperan turno, no fallan. */
const MAX_CONCURRENT = 2;

let running = 0;
const waiting: (() => void)[] = [];

/**
 * Hace el trabajo cuando haya sitio.
 *
 * Una cola, no un rechazo: a quien sube su foto se le hace esperar medio
 * segundo, que es mucho mejor que decirle que vuelva luego.
 */
export async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}
