import 'dotenv/config';

import { presignS3Url } from '../src/lib/storage/sign';
import { s3ConfigFromEnv } from '../src/lib/storage/s3';
import { objectKeyFor } from '../src/lib/storage/key';
import { storeFor } from '../src/lib/storage';

/**
 * Crea el bucket del almacén y COMPRUEBA que esta instalación puede usarlo.
 *
 *   npm run storage:bucket --workspace @citas/web
 *
 * POR QUÉ EXISTE, y no es comodidad: lo hacía `mc`, el cliente de MinIO, que
 * era un SEGUNDO binario que había que descargar de internet dentro del guion
 * de instalación. El primero —el servidor— dejó de descargarse el día que
 * `dl.min.io` empezó a contestar 410, y el guion se paró en seco. Dos binarios
 * traídos de fuera son dos formas de que la instalación se caiga por algo que
 * no es de este proyecto; con esto queda uno.
 *
 * Y de regalo, lo que de verdad importa: esto no habla con el almacén por su
 * cuenta. La comprobación va por `storeFor()`, el MISMO puerto que usa el
 * producto, firmado por la MISMA firma que está comprobada contra el vector
 * oficial de AWS. Así que si esto termina en verde, lo que está probado no es
 * «el bucket existe»: es que las seis variables recién escritas en el `.env`
 * sirven para escribir, leer y borrar una imagen de verdad. `mc` no probaba
 * nada de eso — usa sus propias credenciales y su propio código.
 *
 * Es idempotente: con el bucket ya creado no falla ni lo toca.
 */

/** Lo que contesta un almacén compatible con S3 a un bucket que ya es suyo. */
const YA_ERA_SUYO = new Set([409]);

async function crearBucket(): Promise<string> {
  const config = s3ConfigFromEnv();
  if (config === null) {
    throw new Error(
      'Faltan las variables del almacén. Hacen falta STORAGE_ENDPOINT, ' +
        'STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID y la secreta ' +
        '(STORAGE_SECRET_ACCESS_KEY_ENC, cifrada). Las escribe ' +
        'deploy/minio-instalar.sh.',
    );
  }

  // La llave vacía con el bucket en la ruta es la dirección DEL BUCKET, que es
  // lo que hay que pedir para crearlo. Es el único sitio del proyecto que firma
  // algo que no es un objeto, y por eso se firma aquí a mano en vez de pasar
  // por el puerto: el puerto es un almacén de bytes y no sabe de buckets.
  const url = presignS3Url({
    method: 'PUT',
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    key: '',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresIn: 60,
  });

  const response = await fetch(url, { method: 'PUT', redirect: 'error' });
  if (!response.ok && !YA_ERA_SUYO.has(response.status)) {
    throw new Error(
      `El almacén rechazó crear el bucket «${config.bucket}»: ${response.status}. ` +
        `Endpoint: ${config.endpoint}`,
    );
  }

  return config.bucket;
}

/**
 * Escribe, lee y borra un objeto de verdad, por el puerto del producto.
 *
 * Con una llave con la forma de siempre —`providers/<id>/<uuid>.webp`— porque
 * `ObjectKey` no admite otra cosa, y no se deja detrás: lo último que hace es
 * borrarlo, y comprueba que después ya no está.
 */
async function comprobarIdaYVuelta(): Promise<void> {
  const store = storeFor();
  if (store.id !== 's3') {
    throw new Error(
      'El almacén elegido no es el de S3. Con las variables puestas debería ' +
        'serlo; revise que el `.env` que se está leyendo es el de la web.',
    );
  }

  const key = objectKeyFor('comprobaciondelalmacen', 'webp');
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]);

  await store.put(key, bytes, 'image/webp');

  const leido = await store.get(key);
  if (leido === null) throw new Error('Se escribió y al leerlo no estaba.');
  if (leido.body.length !== bytes.length || !leido.body.every((b, i) => b === bytes[i])) {
    throw new Error('Los bytes volvieron distintos de como se escribieron.');
  }

  await store.remove(key);
  if ((await store.head(key)) !== null) {
    throw new Error('Se borró y sigue estando.');
  }
}

async function main(): Promise<void> {
  const bucket = await crearBucket();
  console.log(`[almacen] bucket «${bucket}» listo`);
  await comprobarIdaYVuelta();
  console.log('[almacen] escribir, leer y borrar: correcto');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
