import { recordAudit } from '@/lib/audit';
import { controlDb } from '@/lib/db/client';
import { storeFor } from '@/lib/storage';
import { asObjectKey } from '@/lib/storage';

import { hoursLeft, isOverdue } from './clock';

/**
 * La moderación: aprobar, rechazar, suspender, verificar y ocultar.
 *
 * Aquí NO hay `ProviderScope`, y esa ausencia es la diferencia entera con
 * `service.ts`: quien modera actúa sobre CUALQUIER proveedor, y lo que decide si
 * puede es la capacidad `directory:moderate`, comprobada por quien llama antes
 * de entrar aquí. Por eso cada función pide el `actorId`: no para saber quién
 * puede —eso ya se decidió— sino para que quede escrito quién lo hizo.
 *
 * Toda decisión escribe DOS cosas en la misma transacción: el estado y la línea
 * de `ProviderReview`. Un historial que se pierde si el proceso muere en medio
 * no es un historial — la misma regla que el de los pagos.
 */

export type ModerationProblem = 'notFound' | 'note' | 'sameState';

export interface QueueRow {
  id: string;
  legalName: string;
  city: string;
  governorate: string;
  submittedAt: Date;
  /** Horas hábiles que quedan del plazo. Cero significa que se pasó. */
  hoursLeft: number;
  overdue: boolean;
  images: number;
  translations: number;
}

/**
 * La cola: lo que espera revisión, LO MÁS VIEJO PRIMERO.
 *
 * Ordenado por antigüedad y no por lo que sea más rápido de mirar: una cola que
 * se atiende por comodidad deja al fondo justo lo que lleva más tiempo
 * esperando. Los atrasados salen marcados, igual que los buzones de SINPE
 * caídos, porque son el mismo tipo de avería: desde fuera se ve igual que si no
 * pasara nada.
 */
export async function reviewQueue(now = new Date()): Promise<QueueRow[]> {
  const rows = await controlDb().provider.findMany({
    where: { status: 'pending_review', submittedAt: { not: null } },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      legalName: true,
      city: true,
      governorate: true,
      submittedAt: true,
      _count: { select: { translations: true } },
      media: { where: { kind: 'image' }, select: { id: true } },
    },
  });

  return rows.flatMap((row) => {
    // El WHERE ya lo excluye; esto es para el tipo, y porque una fila en
    // revisión sin fecha sería un dato roto que no se debe pintar como si
    // tuviera plazo.
    if (row.submittedAt === null) return [];
    return [
      {
        id: row.id,
        legalName: row.legalName,
        city: row.city,
        governorate: row.governorate,
        submittedAt: row.submittedAt,
        hoursLeft: hoursLeft(row.submittedAt, now),
        overdue: isOverdue(row.submittedAt, now),
        images: row.media.length,
        translations: row._count.translations,
      },
    ];
  });
}

/** Las imágenes que esperan, de cualquier proveedor. */
export async function mediaQueue(): Promise<
  { id: string; providerId: string; legalName: string; createdAt: Date; kind: string; externalUrl: string | null }[]
> {
  const rows = await controlDb().providerMedia.findMany({
    where: { status: 'pending_review' },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      providerId: true,
      createdAt: true,
      kind: true,
      externalUrl: true,
      provider: { select: { legalName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    legalName: row.provider.legalName,
    createdAt: row.createdAt,
    kind: row.kind,
    externalUrl: row.externalUrl,
  }));
}

/** Todo lo que hace falta para decidir sobre UN proveedor. */
export async function providerForReview(providerId: string) {
  return controlDb().provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      slug: true,
      legalName: true,
      status: true,
      governorate: true,
      district: true,
      city: true,
      addressPublic: true,
      capacity: true,
      since: true,
      mainLocale: true,
      submittedAt: true,
      publishedAt: true,
      verifiedAt: true,
      rejectedNote: true,
      translations: {
        select: { locale: true, name: true, tagline: true, description: true, services: true },
      },
      categories: { select: { category: true, isPrimary: true } },
      contacts: { select: { channel: true, value: true, isPublic: true } },
      media: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          kind: true,
          status: true,
          hiddenReason: true,
          altText: true,
          externalUrl: true,
        },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { action: true, note: true, createdAt: true, actorId: true },
      },
    },
  });
}

/**
 * Cambia el estado de un proveedor y lo deja escrito, en una transacción.
 *
 * `publishedAt` se pone SOLO la primera vez. Es lo que ordena el listado
 * público, y volver a ponerla en cada aprobación mandaría a lo recién revisado
 * arriba del todo cada vez que alguien mira una ficha vieja.
 */
async function decide(
  providerId: string,
  actorId: string,
  status: 'approved' | 'rejected' | 'suspended',
  action: string,
  note: string | null,
): Promise<{ ok: true } | { ok: false; problems: ModerationProblem[] }> {
  const prisma = controlDb();

  const before = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { status: true, publishedAt: true },
  });
  if (before === null) return { ok: false, problems: ['notFound'] };

  await prisma.$transaction(async (tx) => {
    await tx.provider.update({
      where: { id: providerId },
      data: {
        status,
        reviewedAt: new Date(),
        rejectedNote: status === 'rejected' ? note : null,
        ...(status === 'approved' && before.publishedAt === null
          ? { publishedAt: new Date() }
          : {}),
      },
    });
    await tx.providerReview.create({
      data: { providerId, action, actorId, note },
    });
  });

  await recordAudit({
    tenantId: null,
    actorId,
    action: `directory.${action}`,
    entity: 'Provider',
    entityId: providerId,
    // Qué pasó y desde qué estado. El motivo del rechazo va en la fila de
    // revisión, que es donde lo lee el proveedor; repetirlo aquí sería guardar
    // dos veces un texto que puede llevar el nombre de una persona.
    metadata: { from: before.status, to: status },
  });
  return { ok: true };
}

export async function approveProvider(providerId: string, actorId: string) {
  return decide(providerId, actorId, 'approved', 'approved', null);
}

/**
 * Rechazar EXIGE motivo. Un rechazo sin explicación no se puede corregir: el
 * proveedor vuelve a mandar lo mismo y la cola se llena de la misma ficha.
 */
export async function rejectProvider(providerId: string, actorId: string, note: string) {
  const limpio = note.trim().slice(0, 1000);
  if (limpio.length < 5) return { ok: false as const, problems: ['note' as const] };
  return decide(providerId, actorId, 'rejected', 'rejected', limpio);
}

export async function suspendProvider(providerId: string, actorId: string, note: string) {
  const limpio = note.trim().slice(0, 1000);
  if (limpio.length < 5) return { ok: false as const, problems: ['note' as const] };
  return decide(providerId, actorId, 'suspended', 'suspended', limpio);
}

/** Volver a publicar lo suspendido. */
export async function restoreProvider(providerId: string, actorId: string) {
  return decide(providerId, actorId, 'approved', 'restored', null);
}

/**
 * La insignia de verificado, que NO es lo mismo que aprobado.
 *
 * Aprobado quiere decir «esto no es spam y se puede publicar». Verificado quiere
 * decir «alguien comprobó que este negocio existe y es de quien dice». Mezclarlas
 * sería regalar la segunda a todo el que pase la primera.
 */
export async function setVerified(
  providerId: string,
  actorId: string,
  verified: boolean,
): Promise<{ ok: true } | { ok: false; problems: ModerationProblem[] }> {
  const prisma = controlDb();
  const exists = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { id: true },
  });
  if (exists === null) return { ok: false, problems: ['notFound'] };

  await prisma.$transaction(async (tx) => {
    await tx.provider.update({
      where: { id: providerId },
      data: verified
        ? { verifiedAt: new Date(), verifiedBy: actorId }
        : { verifiedAt: null, verifiedBy: null },
    });
    await tx.providerReview.create({
      data: { providerId, action: verified ? 'verified' : 'unverified', actorId, note: null },
    });
  });

  await recordAudit({
    tenantId: null,
    actorId,
    action: verified ? 'directory.verified' : 'directory.unverified',
    entity: 'Provider',
    entityId: providerId,
    metadata: {},
  });
  return { ok: true };
}

/**
 * Una imagen: aprobarla, rechazarla u ocultarla.
 *
 * Ocultar EXIGE motivo, y lo exige la base (`ProviderMedia_hidden_needs_reason`)
 * además del código: una reclamación de derechos sin resolver y algo que
 * escondió el propio proveedor se resuelven y se notifican distinto, y sin el
 * motivo son la misma fila.
 */
export async function decideMedia(
  mediaId: string,
  actorId: string,
  status: 'approved' | 'rejected' | 'hidden',
  reason: 'copyright' | 'moderation' | 'provider' | null,
): Promise<{ ok: true } | { ok: false; problems: ModerationProblem[] }> {
  const prisma = controlDb();

  const media = await prisma.providerMedia.findUnique({
    where: { id: mediaId },
    select: { providerId: true },
  });
  if (media === null) return { ok: false, problems: ['notFound'] };
  if (status === 'hidden' && reason === null) return { ok: false, problems: ['note'] };

  await prisma.$transaction(async (tx) => {
    await tx.providerMedia.update({
      where: { id: mediaId },
      data: {
        status,
        hiddenReason: status === 'hidden' ? reason : null,
        ...(status === 'approved' ? { publishedAt: new Date() } : {}),
      },
    });
    await tx.providerReview.create({
      data: {
        providerId: media.providerId,
        mediaId,
        action: `media_${status}`,
        actorId,
        note: reason,
      },
    });
  });

  await recordAudit({
    tenantId: null,
    actorId,
    action: `directory.media.${status}`,
    entity: 'ProviderMedia',
    entityId: mediaId,
    metadata: { providerId: media.providerId, ...(reason === null ? {} : { reason }) },
  });
  return { ok: true };
}

/**
 * Borra una imagen de VERDAD: la fila y los bytes.
 *
 * Es lo que hay que hacer cuando una reclamación de derechos se da por buena.
 * Ocultarla deja el archivo en el almacén, y «lo retiramos» tiene que querer
 * decir que ya no está — no que dejamos de enseñarlo.
 */
export async function purgeMedia(
  mediaId: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; problems: ModerationProblem[] }> {
  const prisma = controlDb();
  const media = await prisma.providerMedia.findUnique({
    where: { id: mediaId },
    select: { providerId: true, objectKey: true, thumbKey: true },
  });
  if (media === null) return { ok: false, problems: ['notFound'] };

  // La fila primero: en cuanto no está, la imagen ya no se sirve. Si falla el
  // borrado del objeto queda un huérfano, que no se ve.
  await prisma.$transaction(async (tx) => {
    await tx.providerMedia.delete({ where: { id: mediaId } });
    await tx.providerReview.create({
      data: { providerId: media.providerId, action: 'media_purged', actorId, note: null },
    });
  });

  const store = storeFor();
  for (const raw of [media.objectKey, media.thumbKey]) {
    if (raw === null) continue;
    const key = asObjectKey(raw);
    if (key !== null) await store.remove(key);
  }

  await recordAudit({
    tenantId: null,
    actorId,
    action: 'directory.media.purged',
    entity: 'ProviderMedia',
    entityId: mediaId,
    metadata: { providerId: media.providerId },
  });
  return { ok: true };
}
