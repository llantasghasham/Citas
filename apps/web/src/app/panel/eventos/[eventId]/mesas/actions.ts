'use server';

import { redirect } from 'next/navigation';

import { recordAudit } from '@/lib/audit';
import { getSession, scopeOf, sessionCan, type AuthenticatedSession } from '@/lib/auth/session';
import {
  addTable,
  autoSeat,
  clearSeating,
  editTable,
  removeTable,
  seatGuest,
} from '@/lib/tables/service';
import { getDictionary } from '@citas/core';

/**
 * Las mesas del salón.
 *
 * El id del evento y el de la mesa vienen del formulario, así que NADA se toca
 * sin resolver antes la oficina: eso lo hace `lib/tables/service.ts`, en cada
 * función, y por eso aquí no hay ni una consulta suelta. Un id de la boda de
 * otra oficina no encuentra nada, que es lo mismo que responder «no existe».
 */
type OfficeSession = AuthenticatedSession & { tenantId: string };

async function guard(): Promise<OfficeSession> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }
  return session as OfficeSession;
}

function back(eventId: string, query = ''): never {
  redirect(`/panel/eventos/${eventId}/mesas${query}`);
}

export async function addTableAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const seats = Number.parseInt(String(formData.get('seats') ?? '10'), 10);

  // El prefijo del nombre automático sale del idioma de QUIEN reparte: es una
  // etiqueta que va a leer el salón, no el invitado.
  const prefix = getDictionary(session.locale).admin.tables.prefix;
  const outcome = await addTable(
    scopeOf(session),
    eventId,
    String(formData.get('name') ?? ''),
    seats,
    prefix,
  );
  if (outcome === 'notFound') redirect('/panel');
  if (outcome === 'duplicate') back(eventId, '?error=duplicate');

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'table.add',
    entity: 'Event',
    entityId: eventId,
  });
  back(eventId);
}

export async function editTableAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const outcome = await editTable(
    scopeOf(session),
    eventId,
    String(formData.get('tableId') ?? ''),
    String(formData.get('name') ?? ''),
    Number.parseInt(String(formData.get('seats') ?? '10'), 10),
  );
  if (outcome === 'notFound') back(eventId, '?error=notFound');
  if (outcome === 'duplicate') back(eventId, '?error=duplicate');
  back(eventId);
}

export async function removeTableAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  await removeTable(scopeOf(session), eventId, String(formData.get('tableId') ?? ''));

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'table.remove',
    entity: 'Event',
    entityId: eventId,
  });
  back(eventId);
}

export async function seatGuestAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const raw = String(formData.get('tableId') ?? '');
  await seatGuest(
    scopeOf(session),
    eventId,
    String(formData.get('guestId') ?? ''),
    raw.length === 0 ? null : raw,
  );
  back(eventId);
}

export async function autoSeatAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const moved = await autoSeat(scopeOf(session), eventId);

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'table.autoSeat',
    entity: 'Event',
    entityId: eventId,
    metadata: { moved },
  });
  back(eventId, `?sentados=${moved}`);
}

export async function clearSeatingAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const cleared = await clearSeating(scopeOf(session), eventId);

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'table.clear',
    entity: 'Event',
    entityId: eventId,
    metadata: { cleared },
  });
  back(eventId, `?levantados=${cleared}`);
}
