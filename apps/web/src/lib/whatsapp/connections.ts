import type { WhatsappStatus } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { toE164 } from '@/lib/guests/phone';

/**
 * Los números de WhatsApp de una oficina.
 *
 * Multi-número desde el primer día: una oficina con dos mostradores tiene dos,
 * y todo cuelga de `tenantId` como el resto del negocio. Ninguna consulta de
 * este archivo se hace sin `TenantScope` — un número es la identidad del
 * cliente ante sus invitados, y cruzarlo entre oficinas sería lo peor que puede
 * pasar en este proyecto.
 */
export interface ConnectionRow {
  id: string;
  name: string;
  phone: string | null;
  status: WhatsappStatus;
  qrCode: string | null;
  isDefault: boolean;
  dailyCap: number;
  sentToday: number;
  sentDay: string | null;
  lastSeenAt: Date | null;
  lastError: string | null;
  /** Cuándo se tocó la fila por última vez: es lo que dice si sigue viva. */
  updatedAt: Date;
  /** Lo que le queda por salir de la cola. */
  queued: number;
}

export async function listConnections(scope: TenantScope): Promise<ConnectionRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.whatsappConnection.findMany({
    where: scopedWhere(scope),
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      qrCode: true,
      isDefault: true,
      dailyCap: true,
      sentToday: true,
      sentDay: true,
      lastSeenAt: true,
      lastError: true,
      updatedAt: true,
      _count: { select: { messages: { where: { status: 'queued' } } } },
    },
  });

  return rows.map(({ _count, ...row }) => ({ ...row, queued: _count.messages }));
}

export async function createConnection(
  scope: TenantScope,
  name: string,
  actorId: string,
): Promise<{ id: string } | { error: 'duplicate' | 'empty' }> {
  const clean = name.trim().slice(0, 60);
  if (clean.length === 0) return { error: 'empty' };

  const prisma = getPrisma();
  const existing = await prisma.whatsappConnection.count({ where: scopedWhere(scope) });

  try {
    const created = await prisma.whatsappConnection.create({
      // El primero es el de por defecto sin que nadie lo elija: una oficina con
      // un solo número no debería tener que marcar nada.
      data: { ...scopedWhere(scope), name: clean, isDefault: existing === 0 },
      select: { id: true },
    });

    await recordAudit({
      tenantId: scope.tenantId,
      actorId,
      action: 'whatsapp.connection.create',
      entity: 'WhatsappConnection',
      entityId: created.id,
      metadata: { name: clean },
    });
    return created;
  } catch {
    // El único índice que puede chocar es (tenantId, name).
    return { error: 'duplicate' };
  }
}

/** Confirma que la conexión es de ESTA oficina antes de tocarla. */
export async function ownedConnection(
  scope: TenantScope,
  id: string,
): Promise<{ id: string; name: string } | null> {
  return getPrisma().whatsappConnection.findFirst({
    where: { id, ...scopedWhere(scope) },
    select: { id: true, name: true },
  });
}

/**
 * Lo justo para dibujar la espera del código, resuelto CON el scope.
 *
 * Va aparte de `listConnections` porque lo pide la pantallita del marco, que
 * se recarga cada pocos segundos: contar la cola y traer el resto de números
 * en cada una de esas recargas sería pagar la lista entera por enseñar un
 * cuadrado.
 */
export async function connectionState(
  scope: TenantScope,
  id: string,
): Promise<{
  id: string;
  name: string;
  status: WhatsappStatus;
  qrCode: string | null;
  lastError: string | null;
  updatedAt: Date;
} | null> {
  return getPrisma().whatsappConnection.findFirst({
    where: { id, ...scopedWhere(scope) },
    select: {
      id: true,
      name: true,
      status: true,
      qrCode: true,
      lastError: true,
      updatedAt: true,
    },
  });
}

export async function deleteConnection(
  scope: TenantScope,
  id: string,
  actorId: string,
): Promise<boolean> {
  const owned = await ownedConnection(scope, id);
  if (owned === null) return false;

  await getPrisma().whatsappConnection.delete({ where: { id } });
  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'whatsapp.connection.delete',
    entity: 'WhatsappConnection',
    entityId: id,
    metadata: { name: owned.name },
  });
  return true;
}

/** El tope diario. Se puede bajar; subirlo tiene un techo por una razón. */
export async function setDailyCap(
  scope: TenantScope,
  id: string,
  cap: number,
  actorId: string,
): Promise<void> {
  if ((await ownedConnection(scope, id)) === null) return;

  // Quinientos al día desde un número personal es mucho más de lo que hace una
  // persona, y pasado de ahí no hay freno que salve al número. El campo acepta
  // menos, nunca más.
  const safe = Math.max(1, Math.min(500, Math.trunc(cap)));
  await getPrisma().whatsappConnection.update({ where: { id }, data: { dailyCap: safe } });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'whatsapp.connection.cap',
    entity: 'WhatsappConnection',
    entityId: id,
    metadata: { dailyCap: safe },
  });
}

export async function makeDefault(scope: TenantScope, id: string): Promise<void> {
  if ((await ownedConnection(scope, id)) === null) return;

  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.whatsappConnection.updateMany({
      where: scopedWhere(scope),
      data: { isDefault: false },
    }),
    prisma.whatsappConnection.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export interface QueueOutcome {
  queued: number;
  /** Invitados sin teléfono, o con uno que no se pudo normalizar. */
  skipped: number;
}

/**
 * Encola las invitaciones de un evento para que salgan por WhatsApp.
 *
 * Escribe filas y nada más: quien manda es el servicio, con su retardo al azar
 * y su tope diario. Aquí no se manda un solo mensaje, y eso es deliberado.
 *
 * A quien YA se le escribió no se le vuelve a escribir: encolar dos veces la
 * misma lista es el error que convierte una tanda en spam.
 */
export async function queueEventInvitations(
  scope: TenantScope,
  eventId: string,
  connectionId: string,
  messageFor: (guest: { name: string; token: string; locale: string }) => string,
  actorId: string,
): Promise<QueueOutcome | { error: 'notFound' }> {
  const prisma = getPrisma();

  const [event, connection] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, ...scopedWhere(scope) },
      select: {
        id: true,
        guests: { select: { id: true, name: true, phone: true, token: true, locale: true } },
      },
    }),
    ownedConnection(scope, connectionId),
  ]);
  if (event === null || connection === null) return { error: 'notFound' };

  // Lo ya escrito o en cola por este evento, para no repetir.
  const already = new Set(
    (
      await prisma.whatsappMessage.findMany({
        where: { eventId, status: { in: ['queued', 'sent'] } },
        select: { guestId: true },
      })
    ).flatMap((row) => (row.guestId === null ? [] : [row.guestId])),
  );

  let skipped = 0;
  const rows = event.guests.flatMap((guest) => {
    if (already.has(guest.id)) return [];

    const phone = guest.phone === null ? null : toE164(guest.phone, '+961');
    if (phone === null) {
      skipped += 1;
      return [];
    }

    return [
      {
        ...scopedWhere(scope),
        connectionId,
        eventId,
        guestId: guest.id,
        toPhone: phone,
        body: messageFor({ name: guest.name, token: guest.token, locale: guest.locale }),
      },
    ];
  });

  if (rows.length > 0) await prisma.whatsappMessage.createMany({ data: rows });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'whatsapp.queue',
    entity: 'Event',
    entityId: eventId,
    metadata: { queued: rows.length, skipped, connection: connection.name },
  });

  return { queued: rows.length, skipped };
}

export interface QueueStats {
  queued: number;
  sent: number;
  failed: number;
}

/** Cómo va la tanda de un evento. */
export async function queueStats(scope: TenantScope, eventId: string): Promise<QueueStats> {
  const rows = await getPrisma().whatsappMessage.groupBy({
    by: ['status'],
    where: { eventId, ...scopedWhere(scope) },
    _count: { _all: true },
  });

  const count = (status: string): number =>
    rows.find((row) => row.status === status)?._count._all ?? 0;

  return { queued: count('queued'), sent: count('sent'), failed: count('failed') };
}
