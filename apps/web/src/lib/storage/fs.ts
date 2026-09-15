import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ObjectKey } from './key';
import type { ObjectStore, StoredObject } from './types';

/**
 * El almacén en el DISCO de esta misma máquina.
 *
 * POR QUÉ EXISTE. El plan era MinIO —un servidor compatible con S3 en el propio
 * servidor— y no se pudo: MinIO retiró el binario de la edición comunitaria.
 * `dl.min.io` contesta 410 «Gone» tanto en la dirección de siempre como en la
 * del archivo de una versión concreta, y la imagen de contenedor `minio/minio`
 * dejó de servirse sin credenciales (401 donde cualquier otra imagen pública da
 * 200). No es una avería de una tarde: es una distribución que se retiró.
 *
 * Y mirándolo de frente, para UNA máquina, MinIO nunca fue lo que hacía falta:
 * era un proceso más que mantener, un puerto más que cerrar, unas credenciales
 * más que rotar y un binario más que bajar de internet — todo para hablar el
 * protocolo de S3 con un disco que está a diez centímetros. Esto hace lo mismo
 * con un `open()`.
 *
 * LO QUE NO CAMBIA, y es lo que importa: el puerto. `ObjectStore` sigue siendo
 * el mismo, así que el producto no se entera, y el adaptador de S3 sigue ahí
 * —probado contra un servidor de verdad— para el día que las fotos tengan que
 * irse a R2 o a Amazon. Cambiar de sitio será copiar los archivos y cambiar las
 * variables, no tocar una sola pantalla.
 *
 * DÓNDE VIVE, y no es un detalle. La carpeta tiene que estar FUERA del
 * directorio de la aplicación. Es la misma razón por la que los PNG de `Render`
 * y las fotos de perfil están en PostgreSQL: un despliegue copia el código y se
 * lleva por delante lo que se hubiera dejado al lado. `/var/lib/citas/almacen`
 * sobrevive a los despliegues; `apps/web/almacen` no sobreviviría al primero.
 * `storageDirFromEnv()` lo comprueba y se niega.
 *
 * Y LO QUE SIGUE HACIENDO FALTA: respaldar. Esta carpeta no está en el respaldo
 * de PostgreSQL. `deploy/almacen-instalar.sh` lo dice al terminar.
 */

/**
 * El tipo sale de la EXTENSIÓN, y por eso no hay archivo de metadatos al lado.
 *
 * Se puede porque `ObjectKey` solo admite dos extensiones: es una lista cerrada
 * validada en la frontera, igual que las claves de preferencias o las
 * categorías del directorio. Un archivo `.tipo` junto a cada imagen sería un
 * segundo archivo que puede faltar, quedarse a medias o contradecir al primero.
 */
const TIPO_POR_EXTENSION: Record<string, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
};

function tipoDe(key: ObjectKey): string {
  const extension = key.slice(key.lastIndexOf('.') + 1);
  const tipo = TIPO_POR_EXTENSION[extension];
  // No puede pasar —`ObjectKey` no admite otra cosa— y por eso se levanta en
  // vez de caer a `application/octet-stream`: si algún día pasara, querría
  // decir que la validación de la llave dejó de hacer su trabajo.
  if (tipo === undefined) throw new Error(`Extensión no contemplada: ${key}`);
  return tipo;
}

/**
 * La ruta de una llave, comprobando que NO se sale de la carpeta.
 *
 * `ObjectKey` ya lo impide —su forma no admite un `..`, ni una barra de más, ni
 * un `%2e%2e`— y esto se comprueba igualmente, en la frontera, como
 * `assertDatabaseName` con el nombre de una base. Lo que se incrusta en algo
 * que no admite parámetros —allí una orden SQL, aquí una ruta de disco— se
 * valida donde se incrusta y no donde se construyó.
 */
function rutaDe(root: string, key: ObjectKey): string {
  const completa = resolve(root, key);
  if (completa !== root && !completa.startsWith(root + sep)) {
    throw new Error('La llave se sale de la carpeta del almacén.');
  }
  return completa;
}

function esNoExiste(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export function fsObjectStore(root: string): ObjectStore {
  const base = resolve(root);

  return {
    id: 'fs',

    async put(key, body, contentType) {
      const esperado = tipoDe(key);
      if (contentType !== esperado) {
        // El tipo se deduce de la extensión al leer, así que guardarlo con uno
        // distinto sería servirlo mal después. Se dice aquí, donde se ve la
        // causa, y no en la pantalla de un visitante meses más tarde.
        throw new Error(`«${contentType}» no es el tipo de un ${key.slice(key.lastIndexOf('.'))}.`);
      }

      const destino = rutaDe(base, key);
      await mkdir(dirname(destino), { recursive: true, mode: 0o700 });

      // Se escribe a un temporal y se RENOMBRA. Un `rename` dentro del mismo
      // sistema de archivos es atómico: o está el archivo entero o no está
      // ninguno. Escribiendo directamente, un proceso que muera a la mitad deja
      // media imagen en su sitio, con su fila en la base diciendo que está
      // bien — que es peor que no tenerla.
      const temporal = join(dirname(destino), `.${randomUUID()}.parcial`);
      try {
        await writeFile(temporal, body, { mode: 0o600 });
        await rename(temporal, destino);
      } catch (error) {
        await rm(temporal, { force: true });
        throw error;
      }
    },

    async get(key): Promise<StoredObject | null> {
      try {
        const body = await readFile(rutaDe(base, key));
        return { body: new Uint8Array(body), contentType: tipoDe(key) };
      } catch (error) {
        // Que no esté no es un error: es una respuesta. Cualquier otra cosa
        // —permisos, disco lleno, una ruta que no es una carpeta— SÍ se levanta.
        if (esNoExiste(error)) return null;
        throw error;
      }
    },

    async remove(key) {
      // IDEMPOTENTE: borrar lo que ya no está no falla. `force` es exactamente
      // eso, y hace falta para que la purga de un evento pasado no reviente a
      // la mitad por una imagen que ya se había ido.
      await rm(rutaDe(base, key), { force: true });
    },

    async head(key) {
      try {
        const info = await stat(rutaDe(base, key));
        return { bytes: info.size, contentType: tipoDe(key) };
      } catch (error) {
        if (esNoExiste(error)) return null;
        throw error;
      }
    },
  };
}

/**
 * La carpeta del almacén, leída del ENTORNO y solo del entorno.
 *
 * Como las de S3, y por lo mismo: una ruta de disco editable desde una pantalla
 * es la misma puerta que hubo que cerrar con la dirección del servicio de
 * WhatsApp. `null` significa «no está configurado», no un error.
 */
export function storageDirFromEnv(): string | null {
  const valor = process.env['STORAGE_DIR'];
  if (valor === undefined || valor.length === 0) return null;

  const ruta = resolve(valor);
  if (!valor.startsWith('/')) {
    throw new Error(
      `STORAGE_DIR tiene que ser una ruta absoluta y es «${valor}». Una ruta ` +
        'relativa depende de desde dónde se arrancó el proceso, y un ' +
        'temporizador no arranca desde el mismo sitio que la web.',
    );
  }

  // FUERA del directorio de la aplicación. Un despliegue copia el código y se
  // lleva por delante lo que esté al lado: es la razón por la que los PNG de
  // `Render` y las fotos de perfil viven en PostgreSQL, y aquí la carpeta se
  // pone en /var/lib para que un despliegue no la toque.
  const app = resolve(process.cwd());
  if (ruta === app || ruta.startsWith(app + sep)) {
    throw new Error(
      `STORAGE_DIR no puede estar dentro del directorio de la aplicación ` +
        `(${app}). Un despliegue se lleva por delante lo que haya al lado del ` +
        'código. Use algo como /var/lib/citas/almacen.',
    );
  }

  return ruta;
}
