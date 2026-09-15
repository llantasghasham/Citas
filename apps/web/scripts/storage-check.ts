import 'dotenv/config';

import { presignS3Url } from '../src/lib/storage/sign';
import { s3ConfigFromEnv } from '../src/lib/storage/s3';
import { objectKeyFor } from '../src/lib/storage/key';
import { storeFor } from '../src/lib/storage';

/**
 * Comprueba que esta instalación PUEDE guardar una foto.
 *
 *   npm run storage:check --workspace @citas/web
 *
 * Lo llaman los dos guiones de instalación, y también sirve suelto el día que
 * alguien cambia de almacén o sospecha de él.
 *
 * QUÉ COMPRUEBA, y la diferencia importa: no que el bucket exista ni que la
 * carpeta esté, sino que se puede ESCRIBIR, LEER y BORRAR una imagen por el
 * MISMO puerto que usa el producto, con las mismas variables. Antes esto lo
 * hacía `mc`, el cliente de MinIO, que decía «bucket creado» usando su propio
 * código y sus propias credenciales — o sea que no probaba nada de lo que iba a
 * correr después.
 *
 * Con un almacén compatible con S3 crea además el bucket si falta, firmando con
 * la firma del propio proyecto, la comprobada contra el vector oficial de AWS.
 * Con el disco de esta máquina no hay nada que crear: la carpeta la hace el
 * propio adaptador al escribir.
 *
 * Es idempotente: se puede ejecutar las veces que haga falta.
 */

/** Lo que contesta un almacén compatible con S3 a un bucket que ya es suyo. */
const YA_ERA_SUYO = new Set([409]);

/**
 * Crea el bucket. Solo para S3, y solo si hay configuración de S3.
 *
 * La llave vacía con el bucket en la ruta es la dirección DEL BUCKET, que es lo
 * que hay que pedir para crearlo. Es el único sitio del proyecto que firma algo
 * que no es un objeto, y por eso se firma aquí a mano en vez de pasar por el
 * puerto: el puerto es un almacén de bytes y no sabe de buckets.
 */
async function crearBucketSiHaceFalta(): Promise<string | null> {
  const config = s3ConfigFromEnv();
  if (config === null) return null;

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
async function comprobarIdaYVuelta(): Promise<string> {
  const store = storeFor();
  if (store.id === 'memory') {
    throw new Error(
      'El almacén elegido es el de MEMORIA, que pierde todo al reiniciar. ' +
        'Falta STORAGE_DIR (el disco de esta máquina) o las variables de un ' +
        'almacén compatible con S3. Revise que el `.env` que se está leyendo es ' +
        'el de la web.',
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

  return store.id;
}

async function main(): Promise<void> {
  const bucket = await crearBucketSiHaceFalta();
  if (bucket !== null) console.log(`[almacen] bucket «${bucket}» listo`);

  const cual = await comprobarIdaYVuelta();
  console.log(
    `[almacen] ${cual === 'fs' ? 'disco de esta máquina' : 'compatible con S3'}: ` +
      'escribir, leer y borrar, correcto',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
