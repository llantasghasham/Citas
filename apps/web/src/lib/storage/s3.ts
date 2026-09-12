import { decryptSecret } from '@/lib/secrets';

import type { ObjectKey } from './key';
import { presignS3Url } from './sign';
import type { ObjectStore, StoredObject } from './types';

/**
 * El almacén de verdad: cualquiera compatible con S3.
 *
 * Recomendado Cloudflare R2, y sirve igual Amazon S3, Backblaze B2 o MinIO —lo
 * único que cambia son las seis variables de entorno—. No hay nada de R2 en
 * este archivo: por eso se puede cambiar de proveedor sin tocar el producto.
 *
 * Todo se hace con direcciones PREFIRMADAS que caducan y que firma el servidor.
 * La secreta no sale de aquí y nunca viaja a un navegador.
 */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * La base pública, para el día que haya CDN. Hoy NO se usa: todo se sirve por
   * `/api/d/media/[mediaId]`, que mira el estado. Se lee de todos modos para que
   * una instalación que ya la tenga puesta no la pierda.
   */
  publicBaseUrl: string | null;
}

/** Diez minutos para escribir, borrar o preguntar. Lo pedido. */
const WRITE_SECONDS = 10 * 60;

/**
 * Lee la configuración del ENTORNO, y solo del entorno.
 *
 * Estas seis NO se editan desde el panel, a diferencia del correo y del cobro.
 * Es deliberado y tiene precedente: la dirección del servicio de WhatsApp era
 * editable desde una pantalla y hubo que cerrar esa puerta, porque cambiar un
 * campo de texto convertía el servidor en un ariete con un token dentro. Una
 * dirección de almacén editable es el mismo problema.
 *
 * La secreta se acepta cifrada (`..._ENC`), y en claro SOLO fuera de producción.
 */
export function s3ConfigFromEnv(): S3Config | null {
  const endpoint = process.env['STORAGE_ENDPOINT'];
  const region = process.env['STORAGE_REGION'];
  const bucket = process.env['STORAGE_BUCKET'];
  const accessKeyId = process.env['STORAGE_ACCESS_KEY_ID'];
  if (
    endpoint === undefined || endpoint.length === 0 ||
    region === undefined || region.length === 0 ||
    bucket === undefined || bucket.length === 0 ||
    accessKeyId === undefined || accessKeyId.length === 0
  ) {
    return null;
  }

  const encrypted = process.env['STORAGE_SECRET_ACCESS_KEY_ENC'];
  const plain = process.env['STORAGE_SECRET_ACCESS_KEY'];

  let secretAccessKey: string | undefined;
  if (encrypted !== undefined && encrypted.length > 0) {
    if (!encrypted.startsWith('v1.')) {
      throw new Error(
        'STORAGE_SECRET_ACCESS_KEY_ENC no contiene un valor cifrado (tiene que ' +
          'empezar por "v1."). Parece la clave pegada en claro.',
      );
    }
    secretAccessKey = decryptSecret(encrypted);
  } else if (plain !== undefined && plain.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'STORAGE_SECRET_ACCESS_KEY en claro no se permite en producción: ' +
          'cífrela con `npm run secret:encrypt` y póngala en ..._ENC.',
      );
    }
    secretAccessKey = plain;
  }
  if (secretAccessKey === undefined) return null;

  const publicBase = process.env['STORAGE_PUBLIC_BASE_URL'];
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl:
      publicBase === undefined || publicBase.length === 0
        ? null
        : publicBase.replace(/\/+$/, ''),
  };
}

export function s3ObjectStore(config: S3Config): ObjectStore {
  const sign = (
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    key: ObjectKey,
    seconds: number,
  ): string =>
    presignS3Url({
      method,
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      key,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      expiresIn: seconds,
    });

  return {
    id: 's3',

    async put(key, body, contentType) {
      const response = await fetch(sign('PUT', key, WRITE_SECONDS), {
        method: 'PUT',
        // Una copia sobre su propio `ArrayBuffer`: `fetch` no acepta una vista
        // sobre un buffer compartido, y este es el sitio donde se paga una vez
        // en vez de obligar a todo el programa a construir sus bytes de otra
        // manera.
        body: new Uint8Array(body).buffer as ArrayBuffer,
        headers: { 'content-type': contentType },
        // NO se siguen redirecciones, por lo mismo que en la llamada al servicio
        // de WhatsApp: una redirección es la forma de que una petición firmada
        // acabe en otra máquina.
        redirect: 'error',
      });
      if (!response.ok) {
        throw new Error(`El almacén rechazó la escritura: ${response.status}`);
      }
    },

    async get(key): Promise<StoredObject | null> {
      const response = await fetch(sign('GET', key, WRITE_SECONDS), { redirect: 'error' });
      // Que no esté no es un error: es una respuesta.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`El almacén rechazó la lectura: ${response.status}`);
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async remove(key) {
      const response = await fetch(sign('DELETE', key, WRITE_SECONDS), {
        method: 'DELETE',
        redirect: 'error',
      });
      // 204 borrado, 404 ya no estaba. Las dos son «ya no está», que es lo que
      // se pedía: borrar es idempotente.
      if (!response.ok && response.status !== 404) {
        throw new Error(`El almacén rechazó el borrado: ${response.status}`);
      }
    },

    async head(key) {
      const response = await fetch(sign('HEAD', key, WRITE_SECONDS), {
        method: 'HEAD',
        redirect: 'error',
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`El almacén rechazó la consulta: ${response.status}`);
      return {
        bytes: Number.parseInt(response.headers.get('content-length') ?? '0', 10),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

  };
}
