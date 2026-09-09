'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { saveSetting } from '@/lib/settings';
import {
  createConnection,
  deleteConnection,
  makeDefault,
  ownedConnection,
  setDailyCap,
} from '@/lib/whatsapp/connections';
import { logoutConnection, startConnection } from '@/lib/whatsapp/gateway';

/**
 * Los números de WhatsApp de una oficina.
 *
 * Pide `tenant:manage`: conectar un número es poner la identidad del negocio
 * ante sus clientes en manos de este sistema, y eso no lo hace quien importa
 * una lista.
 *
 * TODAS las acciones resuelven la conexión con el `TenantScope` de la sesión
 * antes de tocarla. El id viaja en el formulario, así que si no se comprobara,
 * cualquiera con sesión podría desconectar el número de otra oficina cambiando
 * un campo oculto.
 */
const VOLVER = '/panel/configuracion?s=whatsapp';

async function require(): Promise<NonNullable<Awaited<ReturnType<typeof getSession>>>> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'tenant:manage') || session.tenantId === null) {
    redirect('/panel');
  }
  return session;
}

export async function addConnectionAction(formData: FormData): Promise<void> {
  const session = await require();

  // El mismo formulario sirve para la dirección del servicio: es un campo de
  // configuración, y separarlo en su propia acción era una acción de una línea.
  if (String(formData.get('sector') ?? '') === 'whatsapp-url') {
    const raw = formData.get('WHATSAPP_GATEWAY_URL');
    if (raw !== null && sessionCan(session, 'platform:manage')) {
      await saveSetting('WHATSAPP_GATEWAY_URL', String(raw), session.userId);
    }
    redirect(`${VOLVER}&guardado=1`);
  }

  const result = await createConnection(
    scopeOf(session),
    String(formData.get('name') ?? ''),
    session.userId,
  );
  if ('error' in result) redirect(`${VOLVER}&error=${result.error}`);

  redirect(`${VOLVER}&nuevo=${result.id}`);
}

/**
 * Abre la sesión. El servicio pide el código a WhatsApp y lo escribe en la
 * fila; la pantalla lo enseña en cuanto se recarga.
 */
export async function connectAction(formData: FormData): Promise<void> {
  const session = await require();
  const id = String(formData.get('id') ?? '');
  if ((await ownedConnection(scopeOf(session), id)) === null) redirect(VOLVER);

  const result = await startConnection(id);
  redirect(result.ok ? `${VOLVER}&esperando=${id}` : `${VOLVER}&servicio=${encodeURIComponent(result.reason ?? '')}`);
}

export async function disconnectAction(formData: FormData): Promise<void> {
  const session = await require();
  const id = String(formData.get('id') ?? '');
  if ((await ownedConnection(scopeOf(session), id)) === null) redirect(VOLVER);

  const result = await logoutConnection(id);
  redirect(result.ok ? VOLVER : `${VOLVER}&servicio=${encodeURIComponent(result.reason ?? '')}`);
}

export async function removeConnectionAction(formData: FormData): Promise<void> {
  const session = await require();
  const id = String(formData.get('id') ?? '');

  // Se cierra la sesión ANTES de borrar la fila: borrarla sin más dejaría el
  // teléfono del cliente con un dispositivo vinculado que ya no controla nadie.
  await logoutConnection(id);
  await deleteConnection(scopeOf(session), id, session.userId);
  redirect(VOLVER);
}

export async function setCapAction(formData: FormData): Promise<void> {
  const session = await require();
  await setDailyCap(
    scopeOf(session),
    String(formData.get('id') ?? ''),
    Number.parseInt(String(formData.get('cap') ?? '0'), 10),
    session.userId,
  );
  redirect(`${VOLVER}&guardado=1`);
}

export async function makeDefaultAction(formData: FormData): Promise<void> {
  const session = await require();
  await makeDefault(scopeOf(session), String(formData.get('id') ?? ''));
  redirect(VOLVER);
}
