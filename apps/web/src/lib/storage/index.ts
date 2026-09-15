import { fsObjectStore, storageDirFromEnv } from './fs';
import { memoryObjectStore } from './memory';
import { s3ConfigFromEnv, s3ObjectStore } from './s3';
import type { ObjectStore } from './types';

export type { ObjectStore, StoredObject } from './types';
export { asObjectKey, isObjectKey, keyBelongsTo, objectKeyFor, type ObjectKey } from './key';

let cached: ObjectStore | null = null;

/**
 * El almacén de esta instalación, y el ÚNICO sitio que decide cuál es.
 *
 * Hay TRES y se ELIGE uno:
 *
 *   · **El disco de esta máquina** (`STORAGE_DIR`). Lo normal en una
 *     instalación de un servidor: un `open()` y nada más que mantener.
 *   · **Uno compatible con S3** (`STORAGE_ENDPOINT` y las demás). R2, Amazon,
 *     B2. Para cuando las fotos tengan que salir de aquí.
 *   · **En memoria**, para desarrollo y pruebas — y en producción SE NIEGA a
 *     arrancar, así que una instalación sin configurar falla RUIDOSAMENTE en
 *     vez de decir «imagen guardada» y tirarla.
 *
 * CON LOS DOS PUESTOS, SE LEVANTA. No se elige uno «por precedencia»: las fotos
 * estarían en el sitio que no se cree quien mira las variables, y el día que
 * alguien quite las de S3 la mitad de las galerías se quedaría vacía sin que
 * nada lo hubiera dicho. Es la misma decisión que `MAILER`, donde tampoco hay
 * respaldo automático entre dos emisores configurados.
 *
 * Es el mismo patrón que `getMailer()` y `getPaymentProvider()`: un solo sitio
 * donde se elige, y el resto del programa sin saber qué hay detrás.
 */
export function storeFor(): ObjectStore {
  if (cached !== null) return cached;

  const s3 = s3ConfigFromEnv();
  const dir = storageDirFromEnv();

  if (s3 !== null && dir !== null) {
    throw new Error(
      'El almacén está configurado DOS veces: STORAGE_DIR (el disco de esta ' +
        'máquina) y STORAGE_ENDPOINT (uno compatible con S3). Quite uno de los ' +
        'dos: con los dos puestos, las fotos acabarían en el sitio que no es y ' +
        'quitar el otro dejaría las galerías vacías sin avisar.',
    );
  }

  cached = s3 !== null ? s3ObjectStore(s3) : dir !== null ? fsObjectStore(dir) : memoryObjectStore();
  return cached;
}

/** Para las pruebas: olvida el elegido. No se usa en producción. */
export function forgetStore(): void {
  cached = null;
}
