'use server';

import { redirect } from 'next/navigation';

import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { saveSetting, type SettingKey } from '@/lib/settings';
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

/**
 * La sesión, y que pueda administrar SU oficina.
 *
 * No se llama `require`: en un módulo compilado a CommonJS ese nombre ya
 * existe, y una función propia que lo tape es una trampa esperando.
 *
 * Cuando falta la oficina NO se rebota al panel en silencio. Rebotar sin decir
 * nada es lo que hizo que «añadir un número» pareciera estar roto sin ninguna
 * pista: se vuelve a la misma pantalla y ella explica qué falta.
 */
async function officeSession(): Promise<
  NonNullable<Awaited<ReturnType<typeof getSession>>>
> {
  const session = await getSession();
  if (session === null) redirect('/entrar');
  if (!sessionCan(session, 'tenant:manage')) redirect('/panel');
  if (session.tenantId === null) redirect(`${VOLVER}&error=sinOficina`);
  return session;
}

/**
 * Los límites del freno, LOS MISMOS que aplica el servicio.
 *
 * Están escritos dos veces —aquí y en `apps/whatsapp/src/config.ts`— porque son
 * dos procesos que no comparten código a propósito. La copia que MANDA es la
 * del servicio, que recorta al leer: si un día se separan, lo que gana es el
 * freno, no la pantalla.
 *
 * El mínimo no es cero y no se negocia: quien monta esto eligió la versión CON
 * freno sobre la versión sin él, y un retardo de cero la convertiría en la que
 * descartó sin que nadie lo decidiera.
 */
const BRAKE = {
  WHATSAPP_DELAY_MIN: { min: 3, max: 300 },
  WHATSAPP_DELAY_MAX: { min: 3, max: 600 },
  WHATSAPP_WARMUP_CAP: { min: 1, max: 100 },
} as const;

async function saveBrake(formData: FormData, actorId: string): Promise<void> {
  for (const [key, bounds] of Object.entries(BRAKE)) {
    const raw = formData.get(key);
    if (raw === null) continue;

    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) continue;

    const safe = Math.min(bounds.max, Math.max(bounds.min, Math.trunc(parsed)));
    await saveSetting(key as SettingKey, String(safe), actorId);
  }
}

export async function addConnectionAction(formData: FormData): Promise<void> {
  const session = await officeSession();

  // El mismo formulario sirve para lo que es de la plataforma y no de la
  // oficina: la dirección del servicio y el freno.
  if (String(formData.get('sector') ?? '') === 'whatsapp-url') {
    if (sessionCan(session, 'platform:manage')) {
      const url = formData.get('WHATSAPP_GATEWAY_URL');
      if (url !== null) await saveSetting('WHATSAPP_GATEWAY_URL', String(url), session.userId);
      await saveBrake(formData, session.userId);
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
  const session = await officeSession();
  const id = String(formData.get('id') ?? '');
  if ((await ownedConnection(scopeOf(session), id)) === null) redirect(VOLVER);

  const result = await startConnection(id);
  redirect(result.ok ? `${VOLVER}&esperando=${id}` : `${VOLVER}&servicio=${encodeURIComponent(result.reason ?? '')}`);
}

export async function disconnectAction(formData: FormData): Promise<void> {
  const session = await officeSession();
  const id = String(formData.get('id') ?? '');
  if ((await ownedConnection(scopeOf(session), id)) === null) redirect(VOLVER);

  const result = await logoutConnection(id);
  redirect(result.ok ? VOLVER : `${VOLVER}&servicio=${encodeURIComponent(result.reason ?? '')}`);
}

export async function removeConnectionAction(formData: FormData): Promise<void> {
  const session = await officeSession();
  const id = String(formData.get('id') ?? '');

  // PRIMERO de quién es, y solo después el servicio. Estaba al revés, y era un
  // agujero de verdad: el servicio acepta un id y un token global, así que un
  // administrador de la oficina A que consiguiera el id de una conexión de B le
  // cerraba el WhatsApp y le destruía las credenciales — la comprobación con el
  // `TenantScope` llegaba cuando el daño ya estaba hecho.
  if ((await ownedConnection(scopeOf(session), id)) === null) redirect(VOLVER);

  // Se cierra la sesión ANTES de borrar la fila: borrarla sin más dejaría el
  // teléfono del cliente con un dispositivo vinculado que ya no controla nadie.
  await logoutConnection(id);
  await deleteConnection(scopeOf(session), id, session.userId);
  redirect(VOLVER);
}

export async function setCapAction(formData: FormData): Promise<void> {
  const session = await officeSession();
  await setDailyCap(
    scopeOf(session),
    String(formData.get('id') ?? ''),
    Number.parseInt(String(formData.get('cap') ?? '0'), 10),
    session.userId,
  );
  redirect(`${VOLVER}&guardado=1`);
}

export async function makeDefaultAction(formData: FormData): Promise<void> {
  const session = await officeSession();
  await makeDefault(scopeOf(session), String(formData.get('id') ?? ''));
  redirect(VOLVER);
}
