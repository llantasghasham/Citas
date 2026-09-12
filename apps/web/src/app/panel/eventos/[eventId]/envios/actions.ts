'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan, type AuthenticatedSession } from '@/lib/auth/session';
import {
  runCampaign,
  type CampaignInput,
  type CampaignKind,
  type CampaignTemplate,
} from '@/lib/whatsapp/campaigns';

/**
 * Lanzar un envío.
 *
 * La vista previa es un GET y esto es lo único que escribe. Están separados a
 * propósito: la pantalla enseña a quién le va a llegar y a quién no ANTES de que
 * nadie pulse nada, porque pulsar «mandar» sobre doscientas personas no se
 * deshace.
 */
type OfficeSession = AuthenticatedSession & { tenantId: string };

async function guard(): Promise<OfficeSession> {
  // Mandar es `event:write`, el mismo permiso que encolar a mano desde la ficha
  // del evento: es la misma acción con otra pantalla delante.
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }
  return session as OfficeSession;
}

function readInput(formData: FormData): CampaignInput {
  const kind = String(formData.get('kind') ?? 'invitation');
  return {
    eventId: String(formData.get('eventId') ?? ''),
    actId: String(formData.get('actId') ?? '') || null,
    segmentId: String(formData.get('segmentId') ?? '') || null,
    kind: (kind === 'reminder' ? 'reminder' : 'invitation') as CampaignKind,
    template: (kind === 'reminder' ? 'reminder' : 'invitation') as CampaignTemplate,
    version: String(formData.get('version') ?? '1'),
    connectionId: String(formData.get('connectionId') ?? ''),
  };
}

export async function runCampaignAction(formData: FormData): Promise<void> {
  const session = await guard();
  const input = readInput(formData);

  const result = await runCampaign(scopeOf(session), input, session.userId);
  if ('error' in result) redirect(`/panel/eventos/${input.eventId}/envios?error=notFound`);

  redirect(
    `/panel/eventos/${input.eventId}/envios?enviados=${result.queued}&fuera=${result.excluded}`,
  );
}
