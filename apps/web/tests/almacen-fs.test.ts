import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { objectKeyFor, type ObjectKey } from '../src/lib/storage/key';
import { fsObjectStore, storageDirFromEnv } from '../src/lib/storage/fs';
import { forgetStore, storeFor } from '../src/lib/storage';

/**
 * EL ALMACÉN EN EL DISCO, contra un disco de verdad.
 *
 * No hay servidor de mentira que montar aquí, así que estas pruebas escriben en
 * una carpeta temporal y la borran al terminar. Lo que comprueban es lo mismo
 * que las del adaptador de S3 —los bytes van y vuelven intactos, «no está» es
 * `null`, borrar es idempotente— más las dos cosas que solo pasan en un disco:
 * que una llave NO puede salirse de la carpeta, y que la carpeta no puede estar
 * dentro del directorio de la aplicación, donde un despliegue se la llevaría.
 */
describe('el almacén en el disco', () => {
  let raiz: string;

  before(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'citas-almacen-'));
  });

  after(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  /** Llaves ACUÑADAS, nunca escritas a mano: ver `tests/almacen-s3.test.ts`. */
  const acunadas = new Map<number, ObjectKey>();
  const llave = (n: number): ObjectKey => {
    const ya = acunadas.get(n);
    if (ya !== undefined) return ya;
    const nueva = objectKeyFor(`prov${String(n).padStart(2, '0')}aaaaaaaaaaaaaaa`, 'webp');
    acunadas.set(n, nueva);
    return nueva;
  };

  it('lo que se escribe es EXACTAMENTE lo que se lee', async () => {
    const store = fsObjectStore(raiz);
    // Bytes que no son texto: un `latin1` mal puesto en medio los rompería y
    // con una cadena de prueba no se notaría.
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x7f, 0x01]);

    await store.put(llave(1), bytes, 'image/webp');
    const leido = await store.get(llave(1));

    assert.ok(leido !== null);
    assert.deepEqual([...leido.body], [...bytes], 'los bytes cambiaron por el camino');
    assert.equal(leido.contentType, 'image/webp');
  });

  it('lo que no está es `null`, no una excepción', async () => {
    const store = fsObjectStore(raiz);
    // Es la diferencia entre «esta foto ya no existe» —que la pantalla sabe
    // pintar— y una excepción que tumba la petición entera.
    assert.equal(await store.get(llave(2)), null);
    assert.equal(await store.head(llave(2)), null);
  });

  it('borrar es IDEMPOTENTE: la segunda vez tampoco falla', async () => {
    const store = fsObjectStore(raiz);
    await store.put(llave(3), new Uint8Array([1, 2, 3]), 'image/webp');

    await store.remove(llave(3));
    // Si esto lanzara, la purga de un evento pasado reventaría a la mitad.
    await store.remove(llave(3));
    assert.equal(await store.get(llave(3)), null);
  });

  it('`head` dice cuánto mide sin traerse los bytes', async () => {
    const store = fsObjectStore(raiz);
    await store.put(llave(4), new Uint8Array(1234), 'image/webp');

    assert.deepEqual(await store.head(llave(4)), { bytes: 1234, contentType: 'image/webp' });
  });

  it('una escritura a medias NO deja media imagen en su sitio', async () => {
    const store = fsObjectStore(raiz);
    await store.put(llave(5), new Uint8Array(4096), 'image/webp');

    // Se escribe a un temporal y se renombra, así que al terminar no puede
    // quedar ningún `.parcial` por ahí. Un archivo a medias con su fila en la
    // base diciendo que está bien es peor que no tener la fila.
    const dentro = await readdir(join(raiz, 'providers', 'prov05aaaaaaaaaaaaaaa'));
    assert.ok(
      dentro.every((nombre) => !nombre.endsWith('.parcial')),
      `quedó un temporal: ${dentro.join(', ')}`,
    );
  });

  it('el tipo tiene que cuadrar con la extensión', async () => {
    const store = fsObjectStore(raiz);
    // El tipo se deduce de la extensión al leer —por eso no hay un archivo de
    // metadatos al lado que pueda faltar o contradecirlo— así que guardarlo con
    // otro sería servirlo mal después, meses más tarde y en otra pantalla.
    await assert.rejects(
      () => store.put(llave(6), new Uint8Array([1]), 'image/png'),
      /image\/png/,
    );
  });

  it('una llave NO puede salirse de la carpeta del almacén', async () => {
    const store = fsObjectStore(raiz);
    // `ObjectKey` ya lo impide: su forma no admite un `..`. Esto comprueba la
    // SEGUNDA red, la de la frontera donde la llave se convierte en una ruta —
    // la misma idea que `assertDatabaseName`. Se fuerza el tipo a propósito:
    // así es como llegaría una fila escrita a mano o por una versión anterior.
    const forzada = '../../../../etc/passwd.webp' as ObjectKey;
    await assert.rejects(() => store.get(forzada), /se sale de la carpeta/);
    await assert.rejects(
      () => store.put(forzada, new Uint8Array([1]), 'image/webp'),
      /se sale de la carpeta/,
    );
  });

  it('dos proveedores no se pisan', async () => {
    const store = fsObjectStore(raiz);
    await store.put(llave(7), new Uint8Array([7]), 'image/webp');
    await store.put(llave(8), new Uint8Array([8, 8]), 'image/webp');

    assert.deepEqual([...(await store.get(llave(7)))!.body], [7]);
    assert.deepEqual([...(await store.get(llave(8)))!.body], [8, 8]);
  });

  describe('de dónde sale la carpeta', () => {
    const antes = process.env['STORAGE_DIR'];
    after(() => {
      if (antes === undefined) delete process.env['STORAGE_DIR'];
      else process.env['STORAGE_DIR'] = antes;
      forgetStore();
    });

    it('sin poner es `null`, que no es un error', () => {
      delete process.env['STORAGE_DIR'];
      assert.equal(storageDirFromEnv(), null);
    });

    it('una ruta RELATIVA se rechaza', () => {
      process.env['STORAGE_DIR'] = 'almacen';
      // Depende de desde dónde se arrancó el proceso, y un temporizador no
      // arranca desde el mismo sitio que la web: las fotos acabarían en dos
      // carpetas distintas según quién las escribiera.
      assert.throws(() => storageDirFromEnv(), /absoluta/);
    });

    it('DENTRO del directorio de la aplicación se rechaza', () => {
      process.env['STORAGE_DIR'] = join(process.cwd(), 'almacen');
      // Es la razón por la que los PNG de `Render` y las fotos de perfil están
      // en PostgreSQL: un despliegue copia el código y se lleva por delante lo
      // que se hubiera dejado al lado. Aquí se dice antes y no después.
      assert.throws(() => storageDirFromEnv(), /despliegue/);
    });

    it('con STORAGE_DIR puesto, `storeFor()` elige el del disco', async () => {
      process.env['STORAGE_DIR'] = raiz;
      forgetStore();

      const store = storeFor();
      assert.equal(store.id, 'fs', 'con la carpeta puesta no puede caer al de memoria');

      // Y escribe DE VERDAD en esa carpeta: un nombre de variable que no
      // coincide no da error, da un almacén de memoria y una foto que se pierde.
      await store.put(llave(9), new Uint8Array([9, 9, 9]), 'image/webp');
      const desdeDisco = await fsObjectStore(raiz).get(llave(9));
      assert.ok(desdeDisco !== null, 'no escribió donde dice STORAGE_DIR');
    });

    it('con los DOS almacenes puestos se LEVANTA en vez de elegir', () => {
      process.env['STORAGE_DIR'] = raiz;
      process.env['STORAGE_ENDPOINT'] = 'http://127.0.0.1:9000';
      process.env['STORAGE_REGION'] = 'us-east-1';
      process.env['STORAGE_BUCKET'] = 'citas-directorio';
      process.env['STORAGE_ACCESS_KEY_ID'] = 'citasaaaaaaaa';
      process.env['STORAGE_SECRET_ACCESS_KEY'] = 'secreta-de-prueba';
      forgetStore();

      try {
        // Elegir uno «por precedencia» dejaría las fotos en el sitio que no se
        // cree quien mira las variables, y el día que alguien quitara el otro
        // media galería se quedaría vacía sin que nada lo dijera.
        assert.throws(() => storeFor(), /DOS veces/);
      } finally {
        for (const nombre of [
          'STORAGE_ENDPOINT',
          'STORAGE_REGION',
          'STORAGE_BUCKET',
          'STORAGE_ACCESS_KEY_ID',
          'STORAGE_SECRET_ACCESS_KEY',
        ]) {
          delete process.env[nombre];
        }
        forgetStore();
      }
    });
  });

  it('no deja nada fuera de su carpeta', async () => {
    // Lo último: todo lo escrito por estas pruebas tiene que estar bajo
    // `providers/`, que es el único prefijo que `ObjectKey` permite.
    const dentro = await readdir(raiz);
    assert.deepEqual(dentro, ['providers']);
    await writeFile(join(raiz, 'centinela'), 'x');
  });
});
