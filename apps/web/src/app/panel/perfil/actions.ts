'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { controlDb } from '@/lib/db/client';
import { mayUsePassword } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';
import { hashPassword, passwordMatches, passwordProblems } from '@/lib/auth/password';
import { recordAudit } from '@/lib/audit';
import { toE164 } from '@/lib/guests/phone';
import { isProblem, processAvatar } from '@/lib/profile/avatar';
import { closeOtherSessions, closeSession } from '@/lib/profile/sessions';
import { isTimezone } from '@/lib/profile/timezones';
import { COUNTRIES, LOCALES } from '@citas/core';

const VOLVER = '/panel/perfil';

/**
 * Cada persona edita lo suyo, y solo lo suyo.
 *
 * El id NO viaja en el formulario: se toma de la sesión. Un campo oculto con el
 * id del usuario en una pantalla de perfil es cómo se edita el perfil de otro.
 *
 * Lo que aquí NO se toca: el rol, la oficina, si es superadministrador y el
 * correo. Los tres primeros los decide quien administra, en otra pantalla, y
 * dejarlos aquí sería dejar que cualquiera se ascienda. El correo es con lo que
 * se entra: cambiarlo desde dentro, sin confirmar el nuevo, es cómo alguien que
 * se cuela una vez se queda con la cuenta para siempre.
 */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const locale = LOCALES.find((candidate) => candidate === String(formData.get('locale')));
  const rawCountry = String(formData.get('country') ?? '');
  const country = COUNTRIES.find((candidate) => candidate.code === rawCountry)?.code ?? null;

  const rawPhone = String(formData.get('phone') ?? '').trim();
  const phone =
    rawPhone.length === 0 ? null : toE164(rawPhone, country === null ? '+961' : dialOf(country));

  // Se comprueba contra la lista del runtime, no contra lo que llegue: una zona
  // inventada rompe el formateo de fechas de todas las pantallas a la vez.
  const rawZone = String(formData.get('timezone') ?? '').trim();
  const timezone = rawZone.length > 0 && isTimezone(rawZone) ? rawZone : null;

  const photo = await photoUpdate(formData);
  if (photo !== null && 'error' in photo) redirect(`${VOLVER}?foto=${photo.error}`);

  await controlDb().user.update({
    where: { id: session.userId },
    data: {
      name: String(formData.get('name') ?? '').trim().slice(0, 120) || null,
      phone,
      country,
      timezone,
      ...(photo ?? {}),
      ...(locale === undefined ? {} : { locale }),
    },
  });

  // El idioma, el país y la foto salen en la cabecera y en los formularios de
  // todas las pantallas: se refresca el panel entero, no solo esta.
  revalidatePath('/panel', 'layout');
  redirect(`${VOLVER}?guardado=1`);
}

/**
 * Qué hacer con la foto en este envío: dejarla como está, quitarla, o poner la
 * que se acaba de subir.
 *
 * Devolver `null` —y no un objeto con los campos a nulo— es la diferencia entre
 * «no venía foto en el formulario» y «quítamela». Sin esa distinción, guardar
 * el teléfono borraría la foto.
 */
async function photoUpdate(
  formData: FormData,
): Promise<
  | null
  | { error: string }
  | {
      avatarData: Uint8Array<ArrayBuffer> | null;
      avatarType: string | null;
      avatarVersion: string | null;
      avatarUrl?: null;
    }
> {
  if (formData.get('removeAvatar') !== null) {
    // Se limpia también la dirección de fuera: si no, quitar la foto subida
    // haría reaparecer la que había antes, que es lo contrario de lo pedido.
    return { avatarData: null, avatarType: null, avatarVersion: null, avatarUrl: null };
  }

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return null;

  const result = await processAvatar(file);
  if (isProblem(result)) return { error: result.error };

  return { avatarData: result.data, avatarType: result.type, avatarVersion: result.version };
}

/**
 * La contraseña propia.
 *
 * La regla del producto no cambia por estar dentro del panel: solo el
 * superadministrador y los administradores de oficina pueden tener una, y el
 * resto entra con el código. Es la misma comprobación que hace
 * `npm run auth:password`, porque una regla que solo vive en un script de
 * consola no es una regla.
 *
 * Quien ya tiene una, la escribe para cambiarla. Una sesión olvidada abierta en
 * un ordenador ajeno no puede servir para quedarse con la cuenta.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  // La MISMA regla que aplica `npm run auth:password` y que ahora comprueba
  // también el propio inicio de sesión. Una sola función, para que no haya dos
  // criterios de quién puede tener contraseña.
  if (!mayUsePassword(session.isSuperadmin, session.role)) redirect(`${VOLVER}?clave=notAllowed`);

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const repeat = String(formData.get('repeatPassword') ?? '');

  if (next !== repeat) redirect(`${VOLVER}?clave=mismatch`);

  const problems = passwordProblems(next);
  if (problems.length > 0) redirect(`${VOLVER}?clave=${problems[0]}`);

  const user = await controlDb().user.findUnique({
    where: { id: session.userId },
    select: { passwordHash: true },
  });
  if (user === null) redirect('/entrar');

  if (user.passwordHash !== null && !(await passwordMatches(current, user.passwordHash))) {
    redirect(`${VOLVER}?clave=wrongCurrent`);
  }

  await controlDb().user.update({
    where: { id: session.userId },
    data: { passwordHash: await hashPassword(next) },
  });

  // Cambiar la contraseña cierra las demás sesiones. Se cambia justamente
  // cuando se teme que alguien la tenga, y dejarle su sesión abierta a ese
  // alguien vaciaría el gesto de sentido.
  const closed = await closeOtherSessions(session.userId, session.sessionId);

  // Queda registrado QUE se cambió. Nunca el valor, ni el viejo ni el nuevo.
  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'auth.password.change',
    entity: 'User',
    entityId: session.userId,
    metadata: { closedSessions: closed },
  });

  redirect(`${VOLVER}?clave=ok`);
}

export async function closeSessionAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const id = String(formData.get('sessionId') ?? '');
  // Cerrar la propia desde esta lista sería salir sin decirlo; para eso está el
  // botón de salir de la cabecera.
  if (id !== session.sessionId) await closeSession(session.userId, id);

  redirect(`${VOLVER}?sesion=cerrada`);
}

export async function closeOthersAction(): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  await closeOtherSessions(session.userId, session.sessionId);
  redirect(`${VOLVER}?sesion=cerradas`);
}

function dialOf(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.dial ?? '+961';
}
