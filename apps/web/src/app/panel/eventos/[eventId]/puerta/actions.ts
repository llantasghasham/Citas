'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan, type AuthenticatedSession } from '@/lib/auth/session';
import { checkIn, revokeCheckIn } from '@/lib/checkin/service';

/**
 * La puerta, el día del evento.
 *
 * El id del acto y el código vienen del formulario, así que son datos del
 * cliente: `lib/checkin/service.ts` comprueba la firma, la oficina, el evento y
 * la autorización antes de escribir nada. Aquí no hay ni una consulta suelta.
 */
type OfficeSession = AuthenticatedSession & { tenantId: string };

async function guard(): Promise<OfficeSession> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }
  return session as OfficeSession;
}

export async function checkInAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const actId = String(formData.get('actId') ?? '');
  const people = Number.parseInt(String(formData.get('people') ?? '1'), 10);

  const outcome = await checkIn(scopeOf(session), eventId, {
    code: String(formData.get('code') ?? ''),
    actId,
    people: Number.isInteger(people) && people > 0 ? people : 1,
    operatorId: session.userId,
    gate: String(formData.get('gate') ?? '') || null,
  });

  // La hora de la primera entrada viaja en la dirección para poder decirla, y
  // nada más: en una puerta hay gente delante mirando la pantalla.
  const extra =
    outcome.ok === false && outcome.reason === 'already_checked_in'
      ? `&desde=${encodeURIComponent(outcome.at.toISOString())}`
      : '';
  const query = outcome.ok
    ? `?acto=${actId}&entro=${encodeURIComponent(outcome.guest.name)}&con=${outcome.guest.people}`
    : `?acto=${actId}&error=${outcome.reason}${extra}`;

  redirect(`/panel/eventos/${eventId}/puerta${query}`);
}

export async function revokeCheckInAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const actId = String(formData.get('actId') ?? '');
  const guestId = String(formData.get('guestId') ?? '');

  await revokeCheckIn(scopeOf(session), eventId, actId, guestId, session.userId);
  redirect(`/panel/eventos/${eventId}/puerta?acto=${actId}`);
}
