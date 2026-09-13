'use server';

import { redirect } from 'next/navigation';

import { getSession, sessionCan } from '@/lib/auth/session';
import { resolveReport } from '@/lib/directory/reports';
import {
  approveProvider,
  decideListing,
  decideMedia,
  purgeMedia,
  rejectProvider,
  restoreProvider,
  setVerified,
  suspendProvider,
} from '@/lib/directory/moderation';

/**
 * Las acciones de la moderación.
 *
 * La comprobación es `directory:moderate` y está en el SERVIDOR, en cada una.
 * No en el layout: que una pantalla no se pinte no impide que alguien mande el
 * formulario, y ocultar un botón no es un permiso. El candado de más está en el
 * reparto de roles — `directory:moderate` no se le puede conceder a un rol de
 * proveedor, ni escribiéndolo ni leyéndolo de una fila vieja— porque un
 * proveedor que se aprueba a sí mismo es el fallo entero de un directorio
 * moderado.
 */
async function guard(): Promise<string> {
  const session = await getSession();
  if (session === null) redirect('/entrar');
  if (!sessionCan(session, 'directory:moderate')) redirect('/panel');
  return session.userId;
}

function volver(providerId: string, extra: string): never {
  redirect(`/panel/moderacion/${encodeURIComponent(providerId)}?${extra}`);
}

export async function approveAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const providerId = String(formData.get('providerId') ?? '');
  const result = await approveProvider(providerId, actorId);
  volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const providerId = String(formData.get('providerId') ?? '');
  const result = await rejectProvider(providerId, actorId, String(formData.get('note') ?? ''));
  volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
}

export async function suspendAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const providerId = String(formData.get('providerId') ?? '');
  const result = await suspendProvider(providerId, actorId, String(formData.get('note') ?? ''));
  volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
}

export async function restoreAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const providerId = String(formData.get('providerId') ?? '');
  const result = await restoreProvider(providerId, actorId);
  volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
}

export async function verifyAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const providerId = String(formData.get('providerId') ?? '');
  const result = await setVerified(providerId, actorId, formData.get('verified') === '1');
  volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
}

export async function mediaAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const providerId = String(formData.get('providerId') ?? '');
  const mediaId = String(formData.get('mediaId') ?? '');
  const decision = String(formData.get('decision') ?? '');

  if (decision === 'purge') {
    const result = await purgeMedia(mediaId, actorId);
    volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
  }

  const status =
    decision === 'approved' || decision === 'rejected' || decision === 'hidden' ? decision : null;
  if (status === null) volver(providerId, 'error=notFound');

  const result = await decideMedia(
    mediaId,
    actorId,
    status,
    // Lo que oculta quien modera es `moderation`; `copyright` lo pone el flujo
    // de una reclamación, que decide otra cosa al resolverse.
    status === 'hidden' ? 'moderation' : null,
  );
  volver(providerId, result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`);
}

/**
 * Resolver una denuncia.
 *
 * `upheld` borra la imagen señalada de verdad, bytes incluidos; `dismissed`
 * devuelve a la calle lo que la denuncia había ocultado — sin eso, una
 * reclamación falsa deja la galería de alguien escondida para siempre.
 */
export async function resolveReportAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const reportId = String(formData.get('reportId') ?? '');
  const outcome = formData.get('outcome') === 'upheld' ? 'upheld' : 'dismissed';

  const result = await resolveReport(
    reportId,
    actorId,
    outcome,
    String(formData.get('note') ?? ''),
  );
  redirect(
    `/panel/moderacion/denuncias?${result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`}`,
  );
}

/**
 * Decidir sobre una fiesta publicada. Rechazar y suspender piden motivo, igual
 * que con un proveedor: sin él, la oficina vuelve a mandar lo mismo.
 */
export async function decideListingAction(formData: FormData): Promise<void> {
  const actorId = await guard();
  const decision = String(formData.get('decision') ?? '');
  const status =
    decision === 'approved' || decision === 'rejected' || decision === 'suspended'
      ? decision
      : null;
  if (status === null) redirect('/panel/moderacion?error=notFound');

  const result = await decideListing(
    String(formData.get('listingId') ?? ''),
    actorId,
    status,
    String(formData.get('note') ?? ''),
  );
  redirect(`/panel/moderacion?${result.ok ? 'guardado=1' : `error=${result.problems.join(',')}`}`);
}
