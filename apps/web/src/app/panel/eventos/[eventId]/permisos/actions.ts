'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan, type AuthenticatedSession } from '@/lib/auth/session';
import { grantConsent, optOut, revokeConsent } from '@/lib/consent/service';
import type { ConsentPurpose, ContactChannel } from '@/generated/prisma/enums';

/**
 * Anotar permisos y bajas.
 *
 * Lo que llega del formulario es un contacto escrito a mano por un operador, así
 * que el servicio lo normaliza antes de mirar nada: un número con espacios y un
 * correo en mayúsculas tienen que dar el mismo permiso que el que ya estaba.
 */
type OfficeSession = AuthenticatedSession & { tenantId: string };

const CHANNELS = ['whatsapp', 'email', 'sms'] as const;
const PURPOSES = ['invitation', 'reminder', 'marketing'] as const;

async function guard(): Promise<OfficeSession> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }
  return session as OfficeSession;
}

function readChannel(formData: FormData): ContactChannel {
  const raw = String(formData.get('channel') ?? '');
  return CHANNELS.find((candidate) => candidate === raw) ?? 'whatsapp';
}

function readPurpose(formData: FormData): ConsentPurpose {
  const raw = String(formData.get('purpose') ?? '');
  return PURPOSES.find((candidate) => candidate === raw) ?? 'invitation';
}

export async function grantConsentAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');

  const result = await grantConsent(scopeOf(session), {
    channel: readChannel(formData),
    purpose: readPurpose(formData),
    contact: String(formData.get('contact') ?? ''),
    source: String(formData.get('source') ?? ''),
    actorId: session.userId,
    defaultCountry: session.country ?? undefined,
  });

  redirect(
    `/panel/eventos/${eventId}/permisos${result.ok ? '' : `?error=${result.reason}`}`,
  );
}

export async function revokeConsentAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');

  await revokeConsent(scopeOf(session), {
    channel: readChannel(formData),
    purpose: readPurpose(formData),
    contact: String(formData.get('contact') ?? ''),
    actorId: session.userId,
    defaultCountry: session.country ?? undefined,
  });
  redirect(`/panel/eventos/${eventId}/permisos`);
}

export async function optOutAction(formData: FormData): Promise<void> {
  const session = await guard();
  const eventId = String(formData.get('eventId') ?? '');
  // Sin propósito: quien pide que no se le escriba no está pidiendo que no se le
  // escriba «para ofertas». Se le deja de escribir.
  const result = await optOut(scopeOf(session), {
    channel: readChannel(formData),
    contact: String(formData.get('contact') ?? ''),
    reason: String(formData.get('reason') ?? '') || null,
    actorId: session.userId,
    defaultCountry: session.country ?? undefined,
  });

  redirect(
    `/panel/eventos/${eventId}/permisos${result.ok ? '' : `?error=${result.reason}`}`,
  );
}
