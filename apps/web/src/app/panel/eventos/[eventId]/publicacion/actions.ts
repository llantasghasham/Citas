'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import {
  createListing,
  deleteListing,
  isEventType,
  submitListing,
  type ListingInput,
} from '@/lib/directory/listings';

/**
 * Publicar una fiesta, desde el panel de la oficina.
 *
 * `event:write` y oficina resuelta por la SESIÓN, como todo lo demás del panel.
 * El `eventId` viene de la dirección, así que es un dato del cliente: el
 * servicio lleva el `tenantId` en el WHERE y una boda de otra oficina no
 * encuentra fila.
 */
async function guard(): Promise<{ userId: string; scope: ReturnType<typeof scopeOf> }> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }
  return { userId: session.userId, scope: scopeOf(session) };
}

function campos(formData: FormData): ListingInput {
  const tipo = String(formData.get('eventType') ?? '');
  return {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    locale: String(formData.get('locale') ?? 'ar'),
    eventType: isEventType(tipo) ? tipo : 'wedding',
    dateMode: String(formData.get('dateMode') ?? 'month'),
    date: String(formData.get('date') ?? ''),
    governorate: String(formData.get('governorate') ?? ''),
    district: String(formData.get('district') ?? ''),
    city: String(formData.get('city') ?? ''),
    venueName: String(formData.get('venueName') ?? ''),
    contactMode: String(formData.get('contactMode') ?? 'none'),
  };
}

export async function createListingAction(formData: FormData): Promise<void> {
  const { userId, scope } = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const destino = `/panel/eventos/${encodeURIComponent(eventId)}/publicacion`;

  const result = await createListing(scope, userId, eventId, campos(formData), {
    by: String(formData.get('authorizedBy') ?? ''),
    text: String(formData.get('authorizationText') ?? ''),
  });

  redirect(result.ok ? `${destino}?creado=1` : `${destino}?error=${result.problems.join(',')}`);
}

export async function submitListingAction(formData: FormData): Promise<void> {
  const { userId, scope } = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const destino = `/panel/eventos/${encodeURIComponent(eventId)}/publicacion`;

  const result = await submitListing(scope, userId, String(formData.get('listingId') ?? ''));
  redirect(result.ok ? `${destino}?enviado=1` : `${destino}?error=${result.problems.join(',')}`);
}

export async function deleteListingAction(formData: FormData): Promise<void> {
  const { userId, scope } = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  const destino = `/panel/eventos/${encodeURIComponent(eventId)}/publicacion`;

  const result = await deleteListing(scope, userId, String(formData.get('listingId') ?? ''));
  redirect(result.ok ? `${destino}?guardado=1` : `${destino}?error=${result.problems.join(',')}`);
}
