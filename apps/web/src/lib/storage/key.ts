import { randomUUID } from 'node:crypto';

/**
 * La llave de un objeto en el almacén.
 *
 * Tipo MARCADO, por la misma razón que `TenantScope`: una llave es un `string`,
 * y si su tipo fuera `string` cualquier texto que llegue de un formulario podría
 * pasar por una. Aquí eso no es un detalle de estilo — la llave lleva el
 * `providerId` dentro, así que un texto ajeno colado en su sitio es leer o
 * pisar el archivo de otro negocio.
 *
 * Solo hay dos formas de tener una: acuñarla con `objectKeyFor()`, que la
 * construye a partir de un ámbito ya resuelto, o validar una que venga de la
 * base con `asObjectKey()`. Nunca desde lo que manda un navegador.
 */
export type ObjectKey = string & { readonly __objectKey: unique symbol };

/**
 * La forma exacta que puede tener una llave.
 *
 * Minúsculas, dígitos, guion y bajo en cada tramo, y la ruta entera fija:
 * `providers/<id>/<uuid>.<ext>`. Es la misma idea que `assertDatabaseName`, y
 * por el mismo motivo: lo que se incrusta en algo que no admite parámetros
 * —allí una orden SQL, aquí una ruta— se valida en la frontera.
 *
 * Lo que esto impide, en concreto: un `..` para salirse del sitio, una barra de
 * más para inventarse un nivel, un `%2e%2e` sin descodificar, y un `providerId`
 * con cualquier cosa dentro.
 */
const KEY_SHAPE = /^providers\/[a-z0-9]{16,32}\/[a-f0-9-]{36}\.(webp|avif)$/;

export function isObjectKey(value: string): value is ObjectKey {
  return KEY_SHAPE.test(value);
}

/**
 * Una llave que viene de la base de datos.
 *
 * Se valida igualmente. No por desconfiar de la base, sino porque una fila
 * puede haber sido escrita a mano, o por una versión anterior de este código, y
 * la frontera es esta función y no la intención de quien escribió la fila.
 */
export function asObjectKey(value: string): ObjectKey | null {
  return isObjectKey(value) ? value : null;
}

/**
 * Acuña una llave nueva para un proveedor.
 *
 * El `providerId` NO se toma de un formulario: lo pone quien llama, y quien
 * llama lo ha resuelto antes contra la membresía. El nombre del archivo que
 * subió alguien no aparece por ningún lado — ni para «conservarlo por
 * comodidad»: es texto de fuera metido en una ruta, y además cuenta cosas de
 * quien lo subió (la carpeta, la cámara, el nombre del cliente).
 */
export function objectKeyFor(providerId: string, extension: 'webp' | 'avif'): ObjectKey {
  if (!/^[a-z0-9]{16,32}$/.test(providerId)) {
    throw new Error('El id de un proveedor no tiene esa forma.');
  }
  const key = `providers/${providerId}/${randomUUID()}.${extension}`;
  if (!isObjectKey(key)) throw new Error('Llave mal formada.');
  return key;
}

/** ¿Es esta llave de este proveedor? Lo que impide leer el archivo de otro. */
export function keyBelongsTo(key: ObjectKey, providerId: string): boolean {
  return key.startsWith(`providers/${providerId}/`);
}
