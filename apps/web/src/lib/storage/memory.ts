import type { ObjectKey } from './key';
import type { ObjectStore, StoredObject } from './types';

/**
 * El almacén de mentira: un `Map` en memoria.
 *
 * Para desarrollo y para las pruebas. Que exista es lo que permite que las
 * pruebas del almacén —incluidas las de aislamiento entre dos proveedores—
 * corran en la integración continua sin una cuenta de nadie y sin tocar la red.
 *
 * Y SE NIEGA A ARRANCAR EN PRODUCCIÓN, igual que el emisor de consola y el
 * proveedor de pago de mentira. La razón no es simetría: un almacén en memoria
 * pierde todo al reiniciar el proceso, así que en producción sería un formulario
 * que dice «imagen guardada» y la tira. Es mejor que no arranque.
 */
export function memoryObjectStore(): ObjectStore {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El almacén en memoria no puede correr en producción.');
  }

  const objects = new Map<string, StoredObject>();

  return {
    id: 'memory',

    put(key, body, contentType) {
      // Se copia: quien llama puede reutilizar su buffer, y guardar una
      // referencia a algo que otro va a escribir encima es un fallo que aparece
      // mucho después y en otro sitio.
      objects.set(key, { body: new Uint8Array(body), contentType });
      return Promise.resolve();
    },

    get(key) {
      const stored = objects.get(key);
      return Promise.resolve(
        stored === undefined
          ? null
          : { body: new Uint8Array(stored.body), contentType: stored.contentType },
      );
    },

    remove(key) {
      objects.delete(key);
      return Promise.resolve();
    },

    head(key) {
      const stored = objects.get(key);
      return Promise.resolve(
        stored === undefined
          ? null
          : { bytes: stored.body.byteLength, contentType: stored.contentType },
      );
    },

    signedReadUrl(key: ObjectKey, seconds: number) {
      // No hay nada que firmar, pero la forma se respeta: quien la use en
      // desarrollo tiene que ver una dirección que caduca, no una eterna.
      const until = Math.floor(Date.now() / 1000) + seconds;
      return Promise.resolve(`memory://${key}?hasta=${until}`);
    },

    publicUrl() {
      // En memoria no hay nada público: se sirve por nuestra ruta, que es
      // además lo que se quiere en la Fase 1.
      return null;
    },
  };
}
