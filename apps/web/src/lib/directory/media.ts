import { recordAudit } from '@/lib/audit';
import { controlDb } from '@/lib/db/client';
import {
  MAX_IMAGE_BYTES,
  normalizeVideoUrl,
  processProviderImage,
  type ImageProblem,
} from '@/lib/storage/image';
import { asObjectKey, objectKeyFor, storeFor, type ObjectKey } from '@/lib/storage';

import { scopedWhere, type ProviderScope } from './scope';

/**
 * Las imágenes de un negocio.
 *
 * Dos decisiones, y las dos son las que se hacen mal cuando se escribe deprisa:
 *
 * 1. **El tope de diez lo impide la BASE, no una cuenta previa.** Cada imagen
 *    ocupa un HUECO del cero al nueve, único por proveedor
 *    (`ProviderMedia_slot_key`): la undécima no tiene dónde ponerse, y dos
 *    subidas a la vez que eligieran el mismo hueco chocan contra el índice —
 *    una gana y la otra reintenta con el siguiente libre.
 *
 *    Estuvo escrito al revés: contar dentro de una transacción con la fila del
 *    proveedor bloqueada. Y la prueba que decía comprobarlo pasaba IGUAL con el
 *    bloqueo quitado, así que no probaba nada: lo único que sostenía el tope era
 *    que Prisma serializa hoy esas transacciones, que es una casualidad de una
 *    versión y no una garantía. Es la misma conclusión a la que ya se llegó con
 *    la cola de WhatsApp y con el código de un solo uso.
 *
 * 2. **Primero el almacén, después la fila.** No son atómicos —son dos
 *    sistemas— así que hay que elegir de qué lado se falla. Un objeto sin fila
 *    no se ve, no se sirve y se barre; una fila sin objeto es un hueco roto en
 *    el perfil de alguien. Y cuando el tope rechaza una subida ya escrita, los
 *    bytes se borran aquí mismo: dejárselos a un repaso que todavía no existe
 *    sería pagar almacén por nada.
 */

/**
 * ¿Chocó contra un índice único?
 *
 * Prisma lo cuenta con el código `P2002`. Se mira la FORMA del error y no se
 * importa la clase: el cliente generado no la exporta desde donde se usa, y una
 * comprobación estructural aquí es más honrada que un `instanceof` contra algo
 * que hay que ir a buscar a otro paquete.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

/**
 * El primer hueco libre, y qué número de orden le toca.
 *
 * Lo que devuelve es una PROPUESTA, no una reserva: entre mirarlo y escribirlo
 * cabe otra petición. Quien escribe se entera por el índice.
 */
async function freeSlot(
  providerId: string,
): Promise<{ slot: number; sortOrder: number } | null> {
  const ocupados = await controlDb().providerMedia.findMany({
    where: { providerId, kind: 'image' },
    select: { slot: true, sortOrder: true },
  });
  const tomados = new Set(ocupados.map((one) => one.slot));

  for (let slot = 0; slot < MAX_IMAGES; slot += 1) {
    if (tomados.has(slot)) continue;
    const ultimo = ocupados.reduce((max, one) => Math.max(max, one.sortOrder), -1);
    return { slot, sortOrder: ultimo + 1 };
  }
  return null;
}

/** Fase 1. Diez es lo que cabe en una galería que alguien mira entera. */
export const MAX_IMAGES = 10;

export type MediaProblem = ImageProblem | 'tooMany' | 'notFound' | 'badVideo';

export interface MediaRow {
  id: string;
  kind: string;
  status: string;
  hiddenReason: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  externalUrl: string | null;
  sortOrder: number;
  createdAt: Date;
}

/** Lo que tiene, en su orden, incluido lo que está en revisión. Es lo suyo. */
export async function listMedia(scope: ProviderScope): Promise<MediaRow[]> {
  return controlDb().providerMedia.findMany({
    where: scopedWhere(scope),
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      kind: true,
      status: true,
      hiddenReason: true,
      altText: true,
      width: true,
      height: true,
      bytes: true,
      externalUrl: true,
      sortOrder: true,
      createdAt: true,
    },
  });
}

/**
 * Sube una imagen.
 *
 * El orden completo, y cada paso está por algo:
 *
 *   1. Una cuenta barata ANTES de gastar CPU. No decide nada —la que decide es
 *      la de dentro de la transacción— pero evita descodificar ocho megas para
 *      luego decir que no caben.
 *   2. `sharp` abre los bytes: si no puede, no es una imagen, y da igual lo que
 *      diga la extensión o el tipo que declare el navegador. Sale recodificada,
 *      girada y SIN metadatos — ahí iban el EXIF y las coordenadas de la casa.
 *   3. La llave la acuña el servidor, con el `providerId` dentro. Nunca el
 *      nombre del archivo de quien sube: es texto de fuera metido en una ruta, y
 *      encima cuenta la carpeta, la cámara y a veces el nombre del cliente.
 *   4. Los bytes al almacén.
 *   5. La fila, con la cuenta de verdad bajo bloqueo.
 */
export async function addImage(
  scope: ProviderScope,
  userId: string,
  file: File,
): Promise<{ ok: true; id: string } | { ok: false; problems: MediaProblem[] }> {
  const prisma = controlDb();

  // Una cuenta barata ANTES de gastar CPU. No decide nada —quien decide es el
  // índice— pero evita descodificar ocho megas para luego decir que no caben.
  const yaHay = await prisma.providerMedia.count({
    where: { ...scopedWhere(scope), kind: 'image' },
  });
  if (yaHay >= MAX_IMAGES) return { ok: false, problems: ['tooMany'] };

  const processed = await processProviderImage(file);
  if ('error' in processed) return { ok: false, problems: [processed.error] };

  const store = storeFor();
  const key = objectKeyFor(scope.providerId, processed.extension);
  // La miniatura es una llave PROPIA, acuñada igual, y no la de arriba con un
  // sufijo pegado: la forma de una llave está fijada en `isObjectKey` —tramo,
  // UUID y extensión— y un `-t` en medio no la cumple. Derivarla habría atado
  // además dos archivos a un mismo nombre, y entonces borrar uno obliga a
  // acordarse del otro.
  const thumbKey = objectKeyFor(scope.providerId, processed.extension);

  await store.put(key, processed.body, processed.contentType);
  await store.put(thumbKey, processed.thumb, processed.contentType);

  // Se intenta ocupar un hueco libre. Un choque contra el índice significa que
  // otra subida se lo llevó entre que se miró y se escribió — que es justo lo
  // que tiene que poder pasar sin que el tope se rompa— así que se mira otra
  // vez. Como mucho hay diez huecos, y el margen cubre que se suelte alguno
  // mientras tanto.
  let created: { id: string } | null = null;
  for (let intento = 0; intento < MAX_IMAGES + 2 && created === null; intento += 1) {
    const libre = await freeSlot(scope.providerId);
    if (libre === null) break;

    try {
      created = await prisma.providerMedia.create({
        data: {
          providerId: scope.providerId,
          kind: 'image',
          slot: libre.slot,
          objectKey: key,
          thumbKey,
          mimeType: processed.contentType,
          bytes: processed.bytes,
          width: processed.width,
          height: processed.height,
          status: 'pending_review',
          sortOrder: libre.sortOrder,
        },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  if (created === null) {
    // No quedaba hueco. Los bytes ya estaban escritos, así que se retiran aquí
    // y no queda huérfano.
    await store.remove(key);
    await store.remove(thumbKey);
    return { ok: false, problems: ['tooMany'] };
  }

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.media.upload',
    entity: 'Provider',
    entityId: scope.providerId,
    // Los bytes y las medidas; NUNCA el nombre del archivo ni nada de dentro.
    metadata: {
      mediaId: created.id,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
    },
  });

  return { ok: true, id: created.id };
}

/**
 * Quita una imagen: la FILA primero y el objeto después, al revés que al subir.
 *
 * En cuanto no hay fila la imagen ya no se sirve, que es lo que importa. Si
 * falla el borrado del objeto queda un huérfano, que no se ve y no cuesta nada
 * más que el sitio que ocupa.
 */
export async function removeMedia(
  scope: ProviderScope,
  userId: string,
  mediaId: string,
): Promise<{ ok: true } | { ok: false; problems: MediaProblem[] }> {
  const prisma = controlDb();

  // El `where` lleva el ámbito: un `mediaId` de otro negocio no encuentra fila
  // en vez de encontrarla y borrarla.
  const row = await prisma.providerMedia.findFirst({
    where: { id: mediaId, ...scopedWhere(scope) },
    select: { id: true, objectKey: true, thumbKey: true },
  });
  if (row === null) return { ok: false, problems: ['notFound'] };

  await prisma.providerMedia.delete({ where: { id: row.id } });

  const store = storeFor();
  const keys = [row.objectKey, row.thumbKey].filter((one): one is string => one !== null);
  for (const key of keys) {
    const objectKey = asObjectKey(key);
    if (objectKey !== null) await store.remove(objectKey);
  }

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.media.remove',
    entity: 'Provider',
    entityId: scope.providerId,
    metadata: { mediaId },
  });
  return { ok: true };
}

/**
 * Sube o baja una imagen, intercambiando los dos `sortOrder` en una
 * transacción. Igual que los actos, y por la misma razón: qué foto va primera es
 * media portada.
 */
export async function moveMedia(
  scope: ProviderScope,
  mediaId: string,
  direction: 'up' | 'down',
): Promise<{ ok: true } | { ok: false; problems: MediaProblem[] }> {
  const prisma = controlDb();

  const row = await prisma.providerMedia.findFirst({
    where: { id: mediaId, ...scopedWhere(scope), kind: 'image' },
    select: { id: true, sortOrder: true },
  });
  if (row === null) return { ok: false, problems: ['notFound'] };

  const vecino = await prisma.providerMedia.findFirst({
    where: {
      ...scopedWhere(scope),
      kind: 'image',
      sortOrder: direction === 'up' ? { lt: row.sortOrder } : { gt: row.sortOrder },
    },
    orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, sortOrder: true },
  });
  // Ya está arriba del todo, o abajo. No es un error: es que no hay a dónde.
  if (vecino === null) return { ok: true };

  await prisma.$transaction([
    prisma.providerMedia.update({ where: { id: row.id }, data: { sortOrder: vecino.sortOrder } }),
    prisma.providerMedia.update({ where: { id: vecino.id }, data: { sortOrder: row.sortOrder } }),
  ]);
  return { ok: true };
}

/** El texto alternativo, que es lo que lee quien no ve la foto. */
export async function setAltText(
  scope: ProviderScope,
  mediaId: string,
  altText: string,
): Promise<{ ok: true } | { ok: false; problems: MediaProblem[] }> {
  const trimmed = altText.trim().slice(0, 200);
  const done = await controlDb().providerMedia.updateMany({
    where: { id: mediaId, ...scopedWhere(scope) },
    data: { altText: trimmed.length === 0 ? null : trimmed },
  });
  return done.count === 0 ? { ok: false, problems: ['notFound'] } : { ok: true };
}

/**
 * El vídeo: UNO, y es una dirección de un sitio conocido.
 *
 * No se aloja vídeo —es otro producto— y no se incrusta un reproductor ajeno en
 * la ficha, que le contaría a ese sitio la IP de todo el que la abre. Vacío lo
 * quita.
 */
export async function setVideo(
  scope: ProviderScope,
  userId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; problems: MediaProblem[] }> {
  const prisma = controlDb();

  if (raw.trim().length === 0) {
    await prisma.providerMedia.deleteMany({ where: { ...scopedWhere(scope), kind: 'video' } });
    return { ok: true };
  }

  const url = normalizeVideoUrl(raw);
  if (url === null) return { ok: false, problems: ['badVideo'] };

  await prisma.$transaction(async (tx) => {
    await tx.providerMedia.deleteMany({ where: { providerId: scope.providerId, kind: 'video' } });
    await tx.providerMedia.create({
      data: {
        providerId: scope.providerId,
        kind: 'video',
        externalUrl: url,
        // Un enlace también pasa por revisión: lo que hay al otro lado lo elige
        // el proveedor y no lo ve nadie hasta que alguien lo mira.
        status: 'pending_review',
        sortOrder: 0,
      },
    });
  });

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.media.video',
    entity: 'Provider',
    entityId: scope.providerId,
    // El sitio, no la dirección entera: identifica el problema sin copiar el
    // dato en otra tabla.
    metadata: { host: new URL(url).host },
  });
  return { ok: true };
}

/**
 * Los bytes de una imagen, para quien tiene derecho a verlos.
 *
 * Devuelve `null` en los dos casos que se contestan igual: no existe, y no se
 * puede ver. La ruta no distingue — distinguirlos convertiría la dirección en
 * una forma de averiguar qué identificadores hay y qué negocios están esperando
 * revisión.
 */
export async function readableMedia(
  mediaId: string,
  viewer: { userId: string | null; isSuperadmin: boolean; canModerate: boolean },
  variant: 'full' | 'thumb',
): Promise<{ key: ObjectKey; mimeType: string } | null> {
  const row = await controlDb().providerMedia.findUnique({
    where: { id: mediaId },
    select: {
      objectKey: true,
      thumbKey: true,
      mimeType: true,
      status: true,
      provider: {
        select: {
          status: true,
          memberships: { select: { userId: true } },
        },
      },
    },
  });
  if (row === null) return null;

  // Pública SOLO si la imagen está aprobada Y el negocio está publicado. Las dos
  // cosas: una imagen aprobada de un negocio suspendido seguiría sirviéndose, y
  // suspender tiene que sacar de la calle lo suyo entero.
  const publica = row.status === 'approved' && row.provider.status === 'approved';

  const suyo =
    viewer.userId !== null &&
    row.provider.memberships.some((membership) => membership.userId === viewer.userId);

  if (!publica && !suyo && !viewer.isSuperadmin && !viewer.canModerate) return null;

  const raw = variant === 'thumb' ? (row.thumbKey ?? row.objectKey) : row.objectKey;
  if (raw === null) return null;
  const key = asObjectKey(raw);
  if (key === null) return null;

  return { key, mimeType: row.mimeType ?? 'image/webp' };
}

export { MAX_IMAGE_BYTES };
