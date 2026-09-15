import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { encryptSecret } from '../src/lib/secrets';
import { objectKeyFor, type ObjectKey } from '../src/lib/storage/key';
import { s3ConfigFromEnv, s3ObjectStore, type S3Config } from '../src/lib/storage/s3';

/**
 * EL ADAPTADOR DE VERDAD, contra un servidor de verdad.
 *
 * Hasta hoy el almacén tenía muchas pruebas y ninguna tocaba esto. Estaban
 * probados la FIRMA —contra el vector oficial de AWS, que es la única forma
 * honesta de saber si una firma hecha a mano vale—, la llave, el almacén de
 * memoria y el recodificado de imágenes. Pero `s3ObjectStore`, que es lo único
 * de todo eso que corre en producción, no había hecho UNA SOLA petición en
 * ninguna prueba. Se iba a estrenar contra el bucket de alguien.
 *
 * Aquí se levanta un servidor HTTP que habla lo justo del protocolo de S3 y se
 * corre el adaptador contra él. Lo que esto prueba —y lo que NO— conviene
 * dejarlo dicho, porque una prueba que se cree más de lo que vale es peor que
 * no tenerla:
 *
 *   SÍ prueba que los bytes van y vuelven intactos, que el tipo que se guarda
 *   es el que se pidió, que «no está» es `null` y no una excepción, que borrar
 *   dos veces no falla, que un error del almacén SÍ se levanta en vez de
 *   tragarse, y que una redirección NO se sigue.
 *
 *   NO prueba que la firma sea correcta. Eso ya lo prueba el vector de AWS, y
 *   comprobarla aquí contra mi propia comprobación no probaría nada: sería la
 *   misma cuenta hecha dos veces por la misma cabeza.
 */
describe('el adaptador S3 contra un servidor', () => {
  /** Lo que el servidor de mentira tiene guardado. */
  const guardado = new Map<string, { body: Buffer; contentType: string }>();
  /** Lo que se le pidió, para poder mirarlo después. */
  const visto: { method: string; path: string; query: URLSearchParams }[] = [];
  /** Cuando está puesto, la siguiente petición contesta esto y se limpia. */
  let responderCon: { status: number; headers?: Record<string, string> } | null = null;

  let server: Server;
  let config: S3Config;

  before(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      visto.push({
        method: req.method ?? '',
        path: url.pathname,
        query: url.searchParams,
      });

      if (responderCon !== null) {
        const { status, headers } = responderCon;
        responderCon = null;
        res.writeHead(status, headers ?? {});
        res.end();
        return;
      }

      // Una dirección prefirmada lleva SIEMPRE estos cinco. Sin ellos no es una
      // petición firmada, y un almacén de verdad la rechazaría — así que si
      // faltara alguno, el fallo aparecería el día del despliegue y no aquí.
      for (const obligatorio of [
        'X-Amz-Algorithm',
        'X-Amz-Credential',
        'X-Amz-Date',
        'X-Amz-Expires',
        'X-Amz-Signature',
      ]) {
        if (url.searchParams.get(obligatorio) === null) {
          res.writeHead(400);
          res.end(`falta ${obligatorio}`);
          return;
        }
      }

      const key = url.pathname;

      if (req.method === 'PUT') {
        const trozos: Buffer[] = [];
        req.on('data', (t: Buffer) => trozos.push(t));
        req.on('end', () => {
          guardado.set(key, {
            body: Buffer.concat(trozos),
            contentType: req.headers['content-type'] ?? 'application/octet-stream',
          });
          res.writeHead(200);
          res.end();
        });
        return;
      }

      const fila = guardado.get(key);

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (fila === undefined) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': fila.contentType,
          'content-length': String(fila.body.length),
        });
        res.end(req.method === 'HEAD' ? undefined : fila.body);
        return;
      }

      if (req.method === 'DELETE') {
        res.writeHead(guardado.delete(key) ? 204 : 404);
        res.end();
        return;
      }

      res.writeHead(405);
      res.end();
    });

    await new Promise<void>((listo) => server.listen(0, '127.0.0.1', listo));
    const { port } = server.address() as AddressInfo;

    config = {
      endpoint: `http://127.0.0.1:${port}`,
      region: 'auto',
      bucket: 'citas-prueba',
      accessKeyId: 'LLAVE-DE-PRUEBA',
      // No es la de nadie: la inventa esta prueba y muere con ella.
      secretAccessKey: 'secreta-de-prueba-que-no-vale-en-ningun-sitio',
      publicBaseUrl: null,
    };
  });

  after(async () => {
    await new Promise<void>((listo) => server.close(() => listo()));
  });

  /**
   * Llaves ACUÑADAS, no escritas a mano.
   *
   * El primer intento las escribió a mano con otra forma, `asObjectKey`
   * devolvió `null` —hizo lo correcto— y el `null` acabó de nombre del objeto:
   * todas las llaves malas escribiendo encima de la misma. No llegó a
   * producción y no podía llegar, porque el tipo marcado lo impide y
   * `npm run typecheck` corre sobre las pruebas en el despliegue. Pero `tsx`
   * NO comprueba tipos, así que en una prueba sí se cuela hasta que alguien
   * compila. Se acuñan con la función de verdad y el problema no existe.
   */
  const acunadas = new Map<number, ObjectKey>();
  const llave = (n: number): ObjectKey => {
    const ya = acunadas.get(n);
    if (ya !== undefined) return ya;
    // Un id con la forma que exige `objectKeyFor`: la de un cuid de Prisma.
    const nueva = objectKeyFor(`prov${String(n).padStart(2, '0')}aaaaaaaaaaaaaaa`, 'webp');
    acunadas.set(n, nueva);
    return nueva;
  };

  it('lo que se escribe es EXACTAMENTE lo que se lee', async () => {
    const store = s3ObjectStore(config);
    // Bytes que no son texto: un `latin1` mal puesto en medio los rompería y
    // con una cadena de prueba no se notaría.
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x7f, 0x01]);

    await store.put(llave(1), bytes, 'image/webp');
    const leido = await store.get(llave(1));

    assert.ok(leido !== null, 'lo que se acaba de escribir tiene que estar');
    assert.deepEqual([...leido.body], [...bytes], 'los bytes cambiaron por el camino');
    assert.equal(leido.contentType, 'image/webp', 'el tipo lo decide el servidor y tiene que viajar');
  });

  it('lo que no está es `null`, no una excepción', async () => {
    const store = s3ObjectStore(config);
    // Es la diferencia entre «esta foto ya no existe» —que la pantalla sabe
    // pintar— y una excepción que tumba la petición entera.
    assert.equal(await store.get(llave(2)), null);
    assert.equal(await store.head(llave(2)), null);
  });

  it('borrar es IDEMPOTENTE: la segunda vez tampoco falla', async () => {
    const store = s3ObjectStore(config);
    await store.put(llave(3), new Uint8Array([1, 2, 3]), 'image/webp');

    await store.remove(llave(3));
    // La segunda contesta 404, y 404 al borrar es «ya no está», que es lo que
    // se pedía. Si esto lanzara, la purga de un evento pasado reventaría a la
    // mitad y dejaría teléfonos sin anonimizar.
    await store.remove(llave(3));
    assert.equal(await store.get(llave(3)), null);
  });

  it('`head` dice cuánto mide sin traerse los bytes', async () => {
    const store = s3ObjectStore(config);
    const bytes = new Uint8Array(1234);
    await store.put(llave(4), bytes, 'image/webp');

    const info = await store.head(llave(4));
    assert.deepEqual(info, { bytes: 1234, contentType: 'image/webp' });
  });

  it('un almacén que falla se NOTA: no se da por escrito lo que no se escribió', async () => {
    const store = s3ObjectStore(config);
    responderCon = { status: 500 };
    // Tragarse esto es como se llega a una fila en la base apuntando a un
    // objeto que no existe: un hueco roto en el perfil de alguien.
    await assert.rejects(
      () => store.put(llave(5), new Uint8Array([1]), 'image/webp'),
      /500/,
    );
  });

  it('NO se sigue una redirección, que es como una petición firmada acaba en otra máquina', async () => {
    const store = s3ObjectStore(config);
    responderCon = {
      status: 302,
      headers: { location: 'http://127.0.0.1:1/robado' },
    };
    // `redirect: 'error'` está puesto a propósito en las cuatro llamadas y es
    // la misma regla que la del servicio de WhatsApp. Sin prueba, quitarlo no
    // rompería nada visible hasta el día que alguien lo aprovechara.
    await assert.rejects(() => store.get(llave(6)));
  });

  it('la petición va al endpoint y al bucket configurados, y a ningún otro sitio', async () => {
    const store = s3ObjectStore(config);
    visto.length = 0;
    await store.put(llave(7), new Uint8Array([9]), 'image/webp');

    const ultima = visto.at(-1);
    assert.ok(ultima !== undefined);
    assert.equal(ultima.method, 'PUT');
    // El bucket va en la ruta, y la llave del proveedor detrás. Una
    // configuración mal leída escribiría en otro sitio sin decir nada.
    assert.ok(
      ultima.path.startsWith('/citas-prueba/'),
      `escribió en ${ultima.path}, que no es el bucket configurado`,
    );
    assert.ok(
      ultima.path.includes('prov07aaaaaaaaaaaaaaa'),
      `la llave del proveedor no está en la ruta: ${ultima.path}`,
    );
  });

  it('LAS SEIS VARIABLES del entorno dan un almacén que funciona', async () => {
    // Esta es la prueba que le importa a quien va a ejecutar
    // `deploy/minio-instalar.sh`: comprueba la cadena entera tal y como la deja
    // ese guion —las seis variables, con la secreta CIFRADA— hasta escribir y
    // leer un objeto. Lo de arriba prueba el adaptador con una configuración
    // escrita a mano; esto prueba que lo que el guion escribe en el `.env` se
    // lee bien. Es donde se rompen estas cosas: un nombre de variable que no
    // coincide no da error, da un almacén de memoria y una foto que se pierde.
    const antes = { ...process.env };
    process.env['CITAS_SECRET_KEY'] = Buffer.alloc(32, 7).toString('base64');

    process.env['STORAGE_ENDPOINT'] = config.endpoint;
    // La que pone el guion para MinIO. R2 usa «auto»; las dos valen.
    process.env['STORAGE_REGION'] = 'us-east-1';
    process.env['STORAGE_BUCKET'] = config.bucket;
    process.env['STORAGE_ACCESS_KEY_ID'] = 'citasaaaaaaaa';
    process.env['STORAGE_SECRET_ACCESS_KEY_ENC'] = encryptSecret('secreta-inventada-por-la-prueba');
    delete process.env['STORAGE_SECRET_ACCESS_KEY'];
    delete process.env['STORAGE_PUBLIC_BASE_URL'];

    const desdeEntorno = s3ConfigFromEnv();
    assert.ok(desdeEntorno !== null, 'con las seis puestas NO puede caer al de memoria');
    assert.equal(desdeEntorno.bucket, config.bucket);
    // Descifrada, no la cadena cifrada: guardarla sin descifrar daría firmas
    // que el almacén rechaza, y el error no se parecería a la causa.
    assert.equal(desdeEntorno.secretAccessKey, 'secreta-inventada-por-la-prueba');

    const store = s3ObjectStore(desdeEntorno);
    const bytes = new Uint8Array([7, 7, 7, 42]);
    await store.put(llave(9), bytes, 'image/webp');
    const leido = await store.get(llave(9));
    assert.ok(leido !== null);
    assert.deepEqual([...leido.body], [...bytes]);

    process.env = antes;
  });

  it('la secreta NO viaja en la dirección', async () => {
    const store = s3ObjectStore(config);
    visto.length = 0;
    await store.put(llave(8), new Uint8Array([9]), 'image/webp');

    const ultima = visto.at(-1);
    assert.ok(ultima !== undefined);
    const entera = `${ultima.path}?${ultima.query.toString()}`;
    // La llave PÚBLICA sí va —es lo que identifica la cuenta— pero la secreta
    // jamás. Esto ya se comprueba sobre la firma; aquí se comprueba sobre lo
    // que de verdad se mandó por el cable.
    assert.ok(!entera.includes(config.secretAccessKey), 'la secreta salió en la petición');
  });
});
