import { createHash } from 'node:crypto';

import { cache } from 'react';
import sharp from 'sharp';

import { recordAudit } from '@/lib/audit';
import { MAX_INPUT_PIXELS, withImageSlot } from '@/lib/images/limits';
import { getPrisma } from '@/lib/db/client';

/**
 * El logo y el icono de la pestaña, subidos desde el ordenador.
 *
 * Antes se pedían como DIRECCIÓN de imagen, y eso es pedirle a una persona
 * normal algo que no tiene: nadie que monta su negocio tiene una URL de su
 * logo, tiene un archivo. Y una dirección de fuera es además una dependencia
 * que se rompe sola el día que caduque ese alojamiento.
 *
 * Lo que se guarda NUNCA es el archivo tal cual: se descodifica, se ajusta al
 * tamaño en que se va a ver y se vuelve a codificar. Las mismas tres razones
 * que en `lib/profile/avatar.ts` —el peso, los metadatos que traen dentro las
 * imágenes, y no servir bytes de origen desconocido— valen igual aquí.
 */

export const BRAND_KINDS = ['logo', 'icon'] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];

/** Un logo no es la foto de una cámara. Cuatro megas sobran de largo. */
export const MAX_BRAND_BYTES = 4 * 1024 * 1024;

// El tope de píxeles y la cola de descodificación son comunes: ver
// `lib/images/limits.ts`.

export type BrandProblem = 'tooBig' | 'notAnImage';

export interface ProcessedBrandImage {
  data: Uint8Array<ArrayBuffer>;
  type: string;
  version: string;
}

export function isBrandProblem(
  result: ProcessedBrandImage | { error: BrandProblem },
): result is { error: BrandProblem } {
  return 'error' in result;
}

/**
 * Convierte lo subido en lo que se guarda, según para qué es.
 *
 * El logo NO se recorta: se ajusta DENTRO de una caja y conserva su forma. Un
 * logo apaisado recortado a cuadrado es un logo destrozado, y quien lo sube ya
 * eligió su proporción. El icono sí es cuadrado, porque una pestaña lo es.
 *
 * Los dos conservan la transparencia: un logo con fondo blanco pegado sobre la
 * cabecera oscura del panel es exactamente lo que nadie quiere ver.
 */
export async function processBrandImage(
  file: File,
  kind: BrandKind,
): Promise<ProcessedBrandImage | { error: BrandProblem }> {
  if (file.size > MAX_BRAND_BYTES) return { error: 'tooBig' };

  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength === 0) return { error: 'notAnImage' };
  if (input.byteLength > MAX_BRAND_BYTES) return { error: 'tooBig' };

  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate();

    const data = await withImageSlot(async () =>
      kind === 'icon'
        ? // PNG y no WEBP para el icono: es el formato que TODO navegador acepta
          // como icono de pestaña sin discusión, y pesa lo que pesa un cuadrado
          // de 256.
          await image.resize(256, 256, { fit: 'cover', position: 'attention' }).png().toBuffer()
        : await image
            .resize(640, 200, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 92 })
            .toBuffer(),
    );

    return {
      data: new Uint8Array(data),
      type: kind === 'icon' ? 'image/png' : 'image/webp',
      version: createHash('sha256').update(data).digest('hex').slice(0, 16),
    };
  } catch {
    return { error: 'notAnImage' };
  }
}

export async function saveBrandAsset(
  kind: BrandKind,
  image: ProcessedBrandImage,
  actorId: string,
): Promise<void> {
  const row = { data: image.data, type: image.type, version: image.version, updatedBy: actorId };
  await getPrisma().brandAsset.upsert({
    where: { kind },
    update: row,
    create: { kind, ...row },
  });

  // Queda registrado QUE cambió el logo, y quién. Los bytes no, evidentemente.
  await recordAudit({
    actorId,
    action: 'system.brand.save',
    entity: 'BrandAsset',
    entityId: kind,
    metadata: { bytes: image.data.byteLength, type: image.type },
  });
}

export async function deleteBrandAsset(kind: BrandKind, actorId: string): Promise<void> {
  const { count } = await getPrisma().brandAsset.deleteMany({ where: { kind } });
  if (count === 0) return;

  await recordAudit({
    actorId,
    action: 'system.brand.delete',
    entity: 'BrandAsset',
    entityId: kind,
  });
}

/**
 * Las huellas de lo que hay subido, para componer las direcciones.
 *
 * Solo las huellas: esto se llama en CADA página que dibuja la cabecera, y
 * traerse los bytes del logo para acabar escribiendo una dirección sería pagar
 * la imagen entera en cada carga de pantalla. Memorizado por petición.
 */
export const brandVersions = cache(
  async (): Promise<Partial<Record<BrandKind, string>>> => {
    const rows = await getPrisma()
      .brandAsset.findMany({ select: { kind: true, version: true } })
      .catch(() => []);

    return Object.fromEntries(rows.map((row) => [row.kind, row.version]));
  },
);

/** La dirección de lo subido, o nula si no hay nada. */
export function brandAssetSrc(kind: BrandKind, version: string | undefined): string | null {
  return version === undefined ? null : `/api/brand/${kind}?v=${version}`;
}
