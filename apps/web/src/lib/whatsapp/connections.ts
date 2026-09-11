import type { WhatsappStatus } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
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
  const prisma = db(scope);
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
      _count: {
        select: { messages: { where: { status: { in: ['queued', 'processing'] } } } },
      },
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

  const prisma = db(scope);
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
  return db(scope).whatsappConnection.findFirst({
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
  return db(scope).whatsappConnection.findFirst({
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

  await db(scope).whatsappConnection.delete({ where: { id } });
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
  await db(scope).whatsappConnection.update({ where: { id }, data: { dailyCap: safe } });

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

  const prisma = db(scope);
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
  /** Antes de esta hora no salen. Nulo es «en cuanto le toque», como siempre. */
  scheduledAt: Date | null = null,
): Promise<QueueOutcome | { error: 'notFound' }> {
  const prisma = db(scope);

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
        where: { eventId, status: { in: ['queued', 'processing', 'sent', 'sent_unknown'] } },
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
        scheduledAt,
      },
    ];
  });

  // `skipDuplicates` se apoya en el índice único parcial de la migración
  // `queue_no_duplicates`: la lectura de arriba dice qué NO hace falta escribir,
  // pero entre leerla y escribir cabe otra petición —dos operadores pulsando
  // «Enviar» a la vez— y entonces cada invitado recibía dos mensajes. Quien lo
  // impide de verdad es la base; esto solo hace que el segundo no dé error.
  const written =
    rows.length === 0
      ? { count: 0 }
      : await prisma.whatsappMessage.createMany({ data: rows, skipDuplicates: true });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'whatsapp.queue',
    entity: 'Event',
    entityId: eventId,
    metadata: {
      queued: written.count,
      skipped,
      connection: connection.name,
      scheduledAt: scheduledAt === null ? null : scheduledAt.toISOString(),
    },
  });

  // Lo que se escribió DE VERDAD, no lo que se intentó: si otra petición ganó
  // la carrera, decir que se encolaron doscientos cuando se encolaron cero
  // sería mentirle a quien acaba de pulsar el botón.
  return { queued: written.count, skipped };
}

/**
 * Lo que hay programado para un evento y todavía no ha salido.
 *
 * Se enseña porque un envío con fecha es una promesa a plazo, y una promesa que
 * no se puede ver ni deshacer da más miedo que tranquilidad: la pareja cambia
 * la fecha, o alguien se equivoca de mes, y hasta ahora no habría forma de
 * saberlo hasta que doscientas personas recibieran el mensaje.
 */
export async function scheduledBatch(
  scope: TenantScope,
  eventId: string,
): Promise<{ count: number; at: Date } | null> {
  const row = await db(scope).whatsappMessage.findFirst({
    where: {
      ...scopedWhere(scope),
      eventId,
      status: 'queued',
      scheduledAt: { gt: new Date() },
    },
    orderBy: { scheduledAt: 'asc' },
    select: { scheduledAt: true },
  });
  if (row?.scheduledAt == null) return null;

  const count = await db(scope).whatsappMessage.count({
    where: { ...scopedWhere(scope), eventId, status: 'queued', scheduledAt: { gt: new Date() } },
  });
  return { count, at: row.scheduledAt };
}

/**
 * Cancela lo que todavía no ha salido.
 *
 * Solo lo PROGRAMADO y solo lo que aún no ha llegado su hora: borrar una cola
 * que ya está saliendo dejaría media lista avisada y media no, que es peor que
 * cualquiera de las dos cosas enteras.
 */
export async function cancelScheduled(
  scope: TenantScope,
  eventId: string,
  actorId: string,
): Promise<number> {
  // Solo lo que sigue en `queued`. Una fila en `processing` ya la tiene cogida
  // el repartidor: borrarla no impide que salga —el mensaje puede estar ya en
  // el aire— y encima borraría el rastro de que salió.
  //
  // Y se MARCA, no se borra: «se canceló» es información, y una fila que
  // desaparece no la da. Además deja volver a encolar a esa persona, porque lo
  // ya escrito se reconoce por `queued` y `sent`.
  const { count } = await db(scope).whatsappMessage.updateMany({
    where: {
      ...scopedWhere(scope),
      eventId,
      status: 'queued',
      scheduledAt: { gt: new Date() },
    },
    data: { status: 'canceled', error: null },
  });

  if (count > 0) {
    await recordAudit({
      tenantId: scope.tenantId,
      actorId,
      action: 'whatsapp.queue.cancel',
      entity: 'Event',
      entityId: eventId,
      metadata: { cancelled: count },
    });
  }
  return count;
}

export interface FailedMessage {
  id: string;
  /** El nombre del invitado, cuando el mensaje salía de una ficha. */
  name: string | null;
  phone: string;
  /** Lo que dijo WhatsApp, recortado por el servicio a algo legible. */
  reason: string | null;
  /** `failed` es «no salió»; `sent_unknown` es «no consta si llegó». */
  status: string;
}

/**
 * Los mensajes de un evento que se rindieron.
 *
 * Existe porque el número de fallidas ya se enseñaba y no se podía hacer nada
 * con él. «12 fallidas» sobre doscientas es una frase que preocupa y no ayuda:
 * no dice a quién no le llegó, ni por qué, ni deja arreglarlo. Y a esos doce hay
 * que escribirles a mano, así que hay que saber quiénes son.
 */
export async function listFailed(
  scope: TenantScope,
  eventId: string,
): Promise<FailedMessage[]> {
  const rows = await db(scope).whatsappMessage.findMany({
    // También las dudosas: un mensaje que WhatsApp aceptó justo cuando se cayó
    // el repartidor no es un fallo, pero tampoco consta que llegara. Callárselo
    // sería peor que decirlo.
    where: { ...scopedWhere(scope), eventId, status: { in: ['failed', 'sent_unknown'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, toPhone: true, error: true, guestId: true, status: true },
  });
  if (rows.length === 0) return [];

  // Los nombres en una sola consulta: una por fila serían doce consultas para
  // pintar una tabla de doce líneas.
  const guests = await db(scope).guest.findMany({
    where: { id: { in: rows.flatMap((row) => (row.guestId === null ? [] : [row.guestId])) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(guests.map((guest) => [guest.id, guest.name]));

  return rows.map((row) => ({
    id: row.id,
    name: row.guestId === null ? null : (nameOf.get(row.guestId) ?? null),
    phone: row.toPhone,
    reason: row.error,
    status: row.status,
  }));
}

/**
 * Devuelve a la cola lo que falló, para que el servicio lo vuelva a intentar.
 *
 * Se reinicia el contador de intentos: lo que se rindió a los tres se rinde
 * otra vez enseguida si no, y reintentar sin darle intentos no es reintentar.
 *
 * NO se reintenta solo. Un mensaje falla por algo —el número no tiene WhatsApp,
 * la sesión se cayó, el cupo del día— y volver a intentarlo en bucle sin que
 * nadie mire es como se quema un número. Lo pulsa una persona que ya ha visto
 * el motivo.
 */
export async function retryFailed(
  scope: TenantScope,
  eventId: string,
  actorId: string,
  /** Uno solo, o toda la tanda si no se dice cuál. */
  messageId?: string,
): Promise<number> {
  const { count } = await db(scope).whatsappMessage.updateMany({
    where: {
      ...scopedWhere(scope),
      eventId,
      status: { in: ['failed', 'sent_unknown'] },
      ...(messageId === undefined ? {} : { id: messageId }),
    },
    data: {
      status: 'queued',
      tries: 0,
      error: null,
      scheduledAt: null,
      claimedBy: null,
      leaseUntil: null,
    },
  });

  if (count > 0) {
    await recordAudit({
      tenantId: scope.tenantId,
      actorId,
      action: 'whatsapp.queue.retry',
      entity: 'Event',
      entityId: eventId,
      metadata: { retried: count },
    });
  }
  return count;
}

export interface QueueStats {
  queued: number;
  sent: number;
  failed: number;
}

/** Cómo va la tanda de un evento. */
export async function queueStats(scope: TenantScope, eventId: string): Promise<QueueStats> {
  const rows = await db(scope).whatsappMessage.groupBy({
    by: ['status'],
    where: { eventId, ...scopedWhere(scope) },
    _count: { _all: true },
  });

  const count = (status: string): number =>
    rows.find((row) => row.status === status)?._count._all ?? 0;

  return {
    // `processing` cuenta como en cola: está saliendo ahora mismo.
    queued: count('queued') + count('processing'),
    sent: count('sent'),
    // Lo dudoso se cuenta con lo fallido: las dos cosas piden que alguien mire.
    failed: count('failed') + count('sent_unknown'),
  };
}
