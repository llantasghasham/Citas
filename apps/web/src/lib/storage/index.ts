import { memoryObjectStore } from './memory';
import { s3ConfigFromEnv, s3ObjectStore } from './s3';
import type { ObjectStore } from './types';

export type { ObjectStore, StoredObject } from './types';
export { asObjectKey, isObjectKey, keyBelongsTo, objectKeyFor, type ObjectKey } from './key';

let cached: ObjectStore | null = null;

/**
 * El almacén de esta instalación, y el ÚNICO sitio que decide cuál es.
 *
 * Con las variables puestas, el de verdad. Sin ellas, el de memoria — que en
 * producción se niega a arrancar, así que una instalación de producción sin
 * bucket falla RUIDOSAMENTE en vez de decir «imagen guardada» y tirarla.
 *
 * Es el mismo patrón que `getMailer()` y `getPaymentProvider()`: un solo sitio
 * donde se elige, y el resto del programa sin saber qué hay detrás.
 */
export function storeFor(): ObjectStore {
  if (cached !== null) return cached;

  const config = s3ConfigFromEnv();
  cached = config === null ? memoryObjectStore() : s3ObjectStore(config);
  return cached;
}

/** Para las pruebas: olvida el elegido. No se usa en producción. */
export function forgetStore(): void {
  cached = null;
}
