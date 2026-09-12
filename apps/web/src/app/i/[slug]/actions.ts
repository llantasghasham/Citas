'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { answerAct } from '@/lib/acts/rsvp';
import { clientIp } from '@/lib/admin/context';
import { visitorAgenda } from '@/lib/rsvp/agenda';
import { guestCookieName } from '@/lib/rsvp/cookie';
import { submitRsvp } from '@/lib/rsvp/service';
import type { RsvpStatus } from '@/generated/prisma/enums';

const SLUG_SHAPE = /^[a-z0-9-]{1,80}$/i;

/**
 * Records a guest's reply. This is a public endpoint by design — the invitation
 * link gets forwarded around WhatsApp — so nothing here trusts the request
 * beyond the slug, and the service re-reads the event from it.
 */
export async function submitRsvpAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  // Guards the redirect below as much as the lookup.
  if (!SLUG_SHAPE.test(slug)) redirect('/');

  const store = await cookies();
  const requestHeaders = await headers();
  const knownToken = store.get(guestCookieName(slug))?.value;

  const result = await submitRsvp({
    slug,
    name: String(formData.get('name') ?? ''),
    status: String(formData.get('status') ?? ''),
    party: String(formData.get('party') ?? '1'),
    message: String(formData.get('message') ?? ''),
    token: knownToken,
    ip: clientIp(requestHeaders),
  });

  if (result.outcome === 'ok' && result.guestToken !== undefined) {
    // Lets the same guest come back and change their answer, with no account.
    store.set(guestCookieName(slug), result.guestToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: `/i/${slug}`,
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  redirect(`/i/${slug}?r=${result.outcome}`);
}

const STATUSES = ['attending', 'declined', 'tentative'] as const;

/**
 * La respuesta a UN acto.
 *
 * Todo lo que decide viene del servidor: el invitado sale de la cookie del
 * enlace personal —no de un campo del formulario— y el acto se comprueba contra
 * SU agenda, no contra el id que llegó. Un `actId` de un acto al que no está
 * invitado no encuentra nada, que es lo mismo que responder «no existe».
 *
 * Sin enlace personal no se contesta por acto. El formulario abierto de siempre
 * sigue estando para quien llega por un reenvío, y ese solo mueve el acto
 * principal: dejar que un desconocido se apunte a una henna privada porque
 * conoce el enlace público es exactamente lo que el reparto por actos evita.
 */
export async function answerActAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  if (!SLUG_SHAPE.test(slug)) redirect('/');

  const actId = String(formData.get('actId') ?? '');
  const rawStatus = String(formData.get('status') ?? '');
  const status = STATUSES.find((candidate) => candidate === rawStatus);
  const party = Number.parseInt(String(formData.get('party') ?? '1'), 10);

  const store = await cookies();
  const token = store.get(guestCookieName(slug))?.value;
  if (status === undefined || token === undefined) redirect(`/i/${slug}?r=invalid`);

  const agenda = await visitorAgenda(slug, token);
  if (agenda === null || agenda.guest === null) redirect(`/i/${slug}?r=invalid`);

  const result = await answerAct(
    agenda.scope,
    agenda.eventId,
    agenda.guest,
    actId,
    {
      status: status as RsvpStatus,
      party: Number.isInteger(party) ? party : 1,
      message: String(formData.get('message') ?? ''),
    },
  );

  redirect(`/i/${slug}?r=${result.ok ? 'ok' : result.reason}#acto-${actId}`);
}
