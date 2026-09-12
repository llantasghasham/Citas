'use server';

import { redirect } from 'next/navigation';

import {
  addAct,
  editAct,
  moveAct,
  removeAct,
  setActAudience,
  type ActInput,
} from '@/lib/acts/service';
import { addSegment, fillSegment, removeSegment, setSegmentMembers } from '@/lib/acts/segments';
import { getSession, scopeOf, sessionCan, type AuthenticatedSession } from '@/lib/auth/session';
import type { AudienceMode } from '@/generated/prisma/enums';

/**
 * Los actos de una celebración.
 *
 * El id del evento y el del acto vienen del formulario, así que son datos del
 * cliente: nada se toca sin resolver antes la oficina Y el evento, y eso lo hace
 * `lib/acts/service.ts` en cada función. Un id de la boda de otra oficina no
 * encuentra nada, que es lo mismo que responder «no existe».
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
  redirect(`/panel/eventos/${eventId}/actos${query}`);
}

function readAct(formData: FormData): ActInput {
  const text = (name: string): string => String(formData.get(name) ?? '');
  return {
    type: text('type'),
    label: text('label'),
    date: text('date'),
    time: text('time'),
    endTime: text('endTime'),
    // Vacía hereda la del evento, que es lo que quiere el caso normal: casi
    // todos los actos de una boda pasan en la misma ciudad.
    timezone: text('timezone').length === 0 ? 'Asia/Beirut' : text('timezone'),
    venueName: text('venueName'),
    venueAddress: text('venueAddress'),
    venueMapUrl: text('venueMapUrl'),
    capacity: text('capacity'),
    optional: formData.get('optional') === 'on',
    rsvpEnabled: formData.get('rsvpEnabled') === 'on',
    rsvpDeadline: text('rsvpDeadline'),
    visibility: text('visibility'),
  };
}

export async function addActAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');

  const result = await addAct(scopeOf(session), eventId, readAct(formData), session.userId);
  if (!result.ok) back(eventId, `?error=${result.problems.join(',')}`);
  back(eventId);
}

export async function editActAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const actId = String(formData.get('actId') ?? '');

  const result = await editAct(scopeOf(session), eventId, actId, readAct(formData), session.userId);
  if (!result.ok) back(eventId, `?error=${result.problems.join(',')}&abierto=${actId}`);
  back(eventId);
}

export async function moveActAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const actId = String(formData.get('actId') ?? '');
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';

  await moveAct(scopeOf(session), eventId, actId, direction);
  back(eventId);
}

export async function removeActAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const actId = String(formData.get('actId') ?? '');

  const result = await removeAct(scopeOf(session), eventId, actId, session.userId);
  if (!result.ok) back(eventId, `?error=${result.reason === 'main' ? 'lastOne' : 'notFound'}`);
  back(eventId);
}

export async function setAudienceAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const actId = String(formData.get('actId') ?? '');
  const segmentId = String(formData.get('segmentId') ?? '');
  const raw = String(formData.get('mode') ?? 'none');
  const mode: AudienceMode | 'none' =
    raw === 'allow' ? 'allow' : raw === 'deny' ? 'deny' : 'none';

  await setActAudience(scopeOf(session), eventId, actId, segmentId, mode, session.userId);
  back(eventId);
}

export async function addSegmentAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const name = String(formData.get('name') ?? '');

  const result = await addSegment(scopeOf(session), eventId, name, session.userId);
  if (!result.ok) back(eventId, '?error=segmentName');
  back(eventId);
}

export async function removeSegmentAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const segmentId = String(formData.get('segmentId') ?? '');

  await removeSegment(scopeOf(session), eventId, segmentId, session.userId);
  back(eventId);
}

export async function fillSegmentAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const segmentId = String(formData.get('segmentId') ?? '');

  const added = await fillSegment(scopeOf(session), eventId, segmentId);
  back(eventId, `?metidos=${added}`);
}

export async function setMembersAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const segmentId = String(formData.get('segmentId') ?? '');
  // Una casilla desmarcada NO manda nada, así que lo que llega es la lista
  // entera de los que quedan dentro y lo que falta es lo que se quitó.
  const guestIds = formData.getAll('guestId').map((value) => String(value));

  const result = await setSegmentMembers(scopeOf(session), eventId, segmentId, guestIds);
  if (result === null) back(eventId, '?error=notFound');
  back(eventId, `?metidos=${result.added}&sacados=${result.removed}`);
}
