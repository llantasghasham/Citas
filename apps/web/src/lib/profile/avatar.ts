import { createHash } from 'node:crypto';

import sharp from 'sharp';

/**
 * La foto de perfil: lo que entra por el formulario y lo que acaba en la base.
 *
 * Lo que se guarda NUNCA es el archivo que subió la persona. Se descodifica, se
 * recorta a un cuadrado pequeño y se vuelve a codificar. Eso resuelve tres
 * cosas de una vez:
 *
 *  1. Una foto de teléfono son cuatro megas y se enseña a treinta y seis
 *     píxeles en la lista del equipo. Guardar el original es pagar mil veces
 *     por lo que se ve.
 *  2. Los metadatos del teléfono viajan dentro del archivo, y entre ellos van
 *     las coordenadas del sitio donde se hizo la foto. Recodificar los tira:
 *     nadie sube su casa a la base de datos sin enterarse.
 *  3. Lo que se sirve es una imagen que ESTE proceso ha escrito, no unos bytes
 *     de origen desconocido con una extensión amable delante.
 */

/** El lado del cuadrado que se guarda. Se enseña a 36 y a 96; 256 cubre las dos. */
export const AVATAR_SIZE = 256;

/**
 * Lo más que se acepta subir. Por encima de esto ni se lee el archivo.
 *
 * Ocho megas parece mucho para una imagen de 256 píxeles, y lo es; el número no
 * lo pone lo que se guarda sino lo que sale de un teléfono. Una foto de un móvil
 * de hoy ronda los cuatro, y quedarse corto aquí significa que la persona no
 * puede poner su cara y no entiende por qué.
 */
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

/**
 * Tope de píxeles al DESCODIFICAR. Un archivo de doscientos kilobytes puede
 * declarar cincuenta mil por cincuenta mil y reventar la memoria del servidor
 * al abrirlo; es un ataque viejo y conocido, y esto es lo que lo para.
 *
 * Ciento veinte millones deja pasar hasta la cámara de doscientos megapíxeles
 * que ya llevan algunos teléfonos, y sigue muy por debajo de lo que hace falta
 * para tumbar el proceso.
 */
const MAX_INPUT_PIXELS = 120_000_000;

export type AvatarProblem = 'tooBig' | 'notAnImage';

export interface ProcessedAvatar {
  /** `Uint8Array` y no `Buffer`: es lo que espera la columna `Bytes`. */
  data: Uint8Array<ArrayBuffer>;
  type: string;
  /** Huella del resultado: va en la dirección para poder cachear sin mentir. */
  version: string;
}

export function isProblem(
  result: ProcessedAvatar | { error: AvatarProblem },
): result is { error: AvatarProblem } {
  return 'error' in result;
}

/**
 * Convierte lo que se subió en lo que se guarda, o dice por qué no puede.
 *
 * No mira la extensión ni el tipo que declara el navegador: los dos los escribe
 * quien envía el formulario. Lo único que decide si esto es una imagen es que
 * el descodificador consiga abrirla.
 */
export async function processAvatar(
  file: File,
): Promise<ProcessedAvatar | { error: AvatarProblem }> {
  if (file.size > MAX_AVATAR_BYTES) return { error: 'tooBig' };

  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength === 0) return { error: 'notAnImage' };
  if (input.byteLength > MAX_AVATAR_BYTES) return { error: 'tooBig' };

  try {
    const data = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      // Las fotos de teléfono vienen tumbadas con una nota que dice «gírame».
      // Sin esto, media oficina sale de lado.
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      // Sin `withMetadata()`: es justo lo que se quiere tirar.
      .webp({ quality: 82 })
      .toBuffer();

    return {
      data: new Uint8Array(data),
      type: 'image/webp',
      version: createHash('sha256').update(data).digest('hex').slice(0, 16),
    };
  } catch {
    // Cualquier cosa que el descodificador no sepa abrir: un PDF renombrado, un
    // archivo cortado a medias, una bomba de descompresión que pasó del tope.
    return { error: 'notAnImage' };
  }
}

/**
 * La dirección de la foto de alguien, sea subida o traída de fuera.
 *
 * Un solo sitio que lo decida, porque se pinta en la cabecera, en el equipo y
 * en el propio perfil, y tres criterios distintos son tres formas de que a uno
 * se le quede la foto vieja.
 */
export function avatarSrc(
  userId: string,
  user: { avatarUrl: string | null; avatarVersion?: string | null },
): string | null {
  if (user.avatarVersion != null && user.avatarVersion.length > 0) {
    return `/api/avatar/${userId}?v=${user.avatarVersion}`;
  }
  return user.avatarUrl;
}
