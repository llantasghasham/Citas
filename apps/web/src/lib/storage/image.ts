import sharp from 'sharp';

import { MAX_INPUT_PIXELS, withImageSlot } from '@/lib/images/limits';

/**
 * Lo que se sube y lo que se guarda, que no son lo mismo.
 *
 * Una imagen de un proveedor entra por el servidor, se abre, se recorta, se
 * vuelve a codificar y SALE OTRO ARCHIVO. Eso no es una optimización: es la
 * única forma de cumplir a la vez las reglas que pidió el encargo —quitar el
 * EXIF y las coordenadas GPS, comprobar el MIME real, medir las dimensiones,
 * rechazar un SVG con JavaScript dentro—, porque todas exigen que el servidor
 * vea los bytes.
 *
 * Por eso la subida NO va del navegador al bucket con una dirección firmada,
 * aunque técnicamente se pueda: por ahí el servidor no ve nada y lo que quedaría
 * guardado es la foto del móvil tal cual, con la casa de alguien dentro.
 *
 * Es el mismo camino que ya hacen la foto de perfil y el logo de la marca.
 */

/** Ocho megas de archivo. El mismo tope que la foto de perfil. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** El lado mayor de lo que se guarda. Suficiente para una pantalla grande. */
const MAX_SIDE = 1600;

/** La miniatura: es lo que se ve en un listado de cincuenta proveedores. */
const THUMB_SIDE = 400;

/**
 * El lado menor que se acepta de entrada.
 *
 * Por debajo de esto no sirve para nada y casi siempre es un error de quien
 * sube: la miniatura en vez de la foto, o una captura de pantalla recortada.
 * Decirlo es más útil que guardar algo que se verá borroso.
 */
const MIN_SIDE = 400;

export type ImageProblem =
  | 'tooBig'
  | 'notAnImage'
  | 'tooSmall'
  | 'tooManyPixels';

export interface ProcessedImage {
  /** La imagen, ya recodificada y sin metadatos. */
  body: Uint8Array;
  /** La miniatura, del mismo archivo. */
  thumb: Uint8Array;
  contentType: 'image/webp';
  extension: 'webp';
  width: number;
  height: number;
  bytes: number;
}

/**
 * Convierte lo subido en lo que se guarda, o dice por qué no puede.
 *
 * NO mira la extensión ni el tipo que declara el navegador: los dos los escribe
 * quien envía el formulario. Lo único que decide si esto es una imagen es que el
 * descodificador consiga abrirla como un mapa de bits — y por eso un SVG no pasa
 * aunque se llame `.webp`: es un documento XML, no un mapa de bits, y `sharp`
 * con `animated: false` y sin el módulo de SVG habilitado no lo entrega como
 * imagen rasterizada de tamaño conocido.
 */
export async function processProviderImage(
  file: File,
): Promise<ProcessedImage | { error: ImageProblem }> {
  if (file.size > MAX_IMAGE_BYTES) return { error: 'tooBig' };

  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength === 0) return { error: 'notAnImage' };
  // Otra vez, y no es redundante: `file.size` lo dice el navegador; esto es lo
  // que de verdad llegó.
  if (input.byteLength > MAX_IMAGE_BYTES) return { error: 'tooBig' };

  try {
    return await withImageSlot(async () => {
      const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
      const meta = await image.metadata();

      // Un SVG abierto por `sharp` no trae densidad ni tamaño de mapa de bits
      // fiable, y además no es lo que se quiere guardar en ningún caso.
      if (meta.format === 'svg') return { error: 'notAnImage' as const };

      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (width === 0 || height === 0) return { error: 'notAnImage' as const };
      if (Math.min(width, height) < MIN_SIDE) return { error: 'tooSmall' as const };

      const body = await image
        .clone()
        // Las fotos de teléfono vienen tumbadas con una nota que dice «gírame».
        // Sin esto, media galería sale de lado.
        .rotate()
        .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        // SIN `withMetadata()`: es justo lo que hay que tirar. Ahí van el EXIF,
        // el modelo del teléfono y las coordenadas de dónde se hizo la foto.
        .webp({ quality: 82 })
        .toBuffer();

      const thumb = await image
        .clone()
        .rotate()
        .resize(THUMB_SIDE, THUMB_SIDE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 78 })
        .toBuffer();

      // Las de SALIDA, leídas del resultado y no calculadas a mano: el
      // `.rotate()` puede haber intercambiado el ancho y el alto.
      const out = await sharp(body).metadata();

      return {
        body: new Uint8Array(body),
        thumb: new Uint8Array(thumb),
        contentType: 'image/webp' as const,
        extension: 'webp' as const,
        width: out.width ?? 0,
        height: out.height ?? 0,
        bytes: body.byteLength,
      };
    });
  } catch (error) {
    // El tope de píxeles lo lanza `sharp` con su propio mensaje, y distinguirlo
    // importa: «demasiados píxeles» se arregla subiendo otra foto, y «no es una
    // imagen» no.
    if (String(error).includes('pixels')) return { error: 'tooManyPixels' };
    // Cualquier otra cosa que el descodificador no sepa abrir: un PDF
    // renombrado, un archivo cortado a medias, una bomba de descompresión.
    return { error: 'notAnImage' };
  }
}

/** Los dominios de los que se acepta un vídeo. Es un ENLACE, no un archivo. */
const VIDEO_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
]);

/**
 * Un vídeo es una dirección de un sitio conocido, y nada más.
 *
 * Alojar vídeo es otro producto: pesa cien veces más que una foto, hay que
 * transcodificarlo y hay que servirlo. Y una dirección libre es un agujero: una
 * página cualquiera metida en un `<iframe>` del perfil de un salón ejecuta lo
 * que quiera en nuestro dominio.
 */
export function normalizeVideoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (!VIDEO_HOSTS.has(url.host.toLowerCase())) return null;
  return url.toString();
}
