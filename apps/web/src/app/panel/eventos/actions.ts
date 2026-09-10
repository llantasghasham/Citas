'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestHost } from '@/lib/admin/context';

import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { parseGuestList } from '@/lib/guests/import';
import { markPaidInCash, openPackageOrder } from '@/lib/billing/checkout';
import { COUNTRY_CODES, toE164 } from '@/lib/guests/phone';
import { importGuests } from '@/lib/repositories/guests';
import { addEventVersion } from '@/lib/repositories/versions';
import { getPrisma } from '@/lib/db/client';
import { zonedToUtc } from '@/lib/time/zoned';
import { cancelScheduled, queueEventInvitations } from '@/lib/whatsapp/connections';
import { setReminder } from '@/lib/whatsapp/reminders';
import { COUNTRIES, getDictionary, interpolate, LOCALES, type Locale } from '@citas/core';

/** A client's list is not small: a wedding is two hundred lines, not five. */
const MAX_INPUT_BYTES = 512 * 1024;

export async function importGuestsAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const file = formData.get('file');
  const pasted = String(formData.get('list') ?? '');

  // A file wins over the box: someone who attached one meant to use it.
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (text.length === 0 || text.length > MAX_INPUT_BYTES) {
    redirect(`/panel/eventos/${eventId}?error=1`);
  }

  const country =
    COUNTRY_CODES.find((code) => code === String(formData.get('country'))) ?? '+961';
  const fallbackLocale =
    LOCALES.find((locale) => locale === String(formData.get('locale'))) ?? ('ar' as Locale);

  const { guests, skipped } = parseGuestList(text, country, fallbackLocale);
  const result = await importGuests(scopeOf(session), eventId, guests);
  if (!result.ok) {
    if (result.reason === 'notFound') redirect('/panel');
    // Nada se escribió: se dice cuánto cabe y cuánto se pidió, para que la
    // oficina sepa qué paquete le falta en vez de solo que "no pudo".
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'guests.import.refused',
      entity: 'Event',
      entityId: eventId,
      metadata: { allowed: result.allowed, used: result.used, asked: result.asked },
    });
    redirect(
      `/panel/eventos/${eventId}?limite=1&cabe=${result.allowed}&hay=${result.used}&pedidos=${result.asked}`,
    );
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'guests.import',
    entity: 'Event',
    entityId: eventId,
    metadata: { added: result.added, skipped },
  });

  redirect(`/panel/eventos/${eventId}?added=${result.added}&skipped=${skipped}`);
}

/**
 * Writes the event out in one more language.
 *
 * The office types it: nothing is machine-translated here, and the verse comes
 * from the same closed, human-verified list as everywhere else.
 */
export async function addVersionAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const locale = LOCALES.find((candidate) => candidate === String(formData.get('locale')));
  if (locale === undefined) redirect(`/panel/eventos/${eventId}?error=1`);

  const result = await addEventVersion(scopeOf(session), eventId, {
    locale,
    message: String(formData.get('message') ?? '').slice(0, 600),
    quoteId: String(formData.get('quoteId') ?? '').slice(0, 80),
  });
  if (!result.ok) {
    if (result.reason === 'notFound') redirect('/panel');
    redirect(`/panel/eventos/${eventId}?error=1`);
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'event.version.add',
    entity: 'Event',
    entityId: eventId,
    metadata: { locale, slug: result.slug },
  });

  redirect(`/panel/eventos/${eventId}?version=${locale}`);
}

/**
 * Vende un paquete de invitaciones para esta boda.
 *
 * Crea el pedido y su enlace público de pago; no cobra nada y no abre ninguna
 * invitación. Eso lo hace `settlePublicOrder()` cuando el proveedor confirma,
 * que es el único que puede decirlo.
 *
 * Pide `billing:manage` y no `event:write`: quien importa una lista no
 * necesariamente puede emitir un cobro a nombre de la oficina.
 */
export async function sellPackageAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'billing:manage') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const clientName = String(formData.get('clientName') ?? '').trim().slice(0, 120);
  const rawPhone = String(formData.get('clientPhone') ?? '').trim();
  if (clientName.length === 0) redirect(`/panel/eventos/${eventId}?error=1`);

  // El mismo E.164 que los invitados: un teléfono guardado de dos formas es un
  // teléfono que no sirve para escribirle a nadie.
  const country = COUNTRY_CODES.find((code) => code === String(formData.get('country'))) ?? '+961';
  const clientPhone = rawPhone.length === 0 ? null : toE164(rawPhone, country);

  const result = await openPackageOrder(
    scopeOf(session),
    { eventId, packageId: String(formData.get('packageId') ?? ''), clientName, clientPhone },
    session.userId,
  );
  if ('error' in result) {
    if (result.error === 'notFound') redirect('/panel');
    redirect(`/panel/eventos/${eventId}?error=1`);
  }

  redirect(`/panel/eventos/${eventId}?vendido=${result.payToken}#paquetes`);
}

/**
 * Anota que un paquete se cobró en efectivo.
 *
 * Lo hace una PERSONA con su nombre, y queda en el historial. Es la única
 * forma de marcar pagado sin proveedor, y por eso vive aquí, en el panel, y no
 * en el enlace público: quien paga nunca puede marcarse a sí mismo como pagado.
 */
export async function markCashAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'billing:manage') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const ok = await markPaidInCash(scopeOf(session), orderId, session.userId);

  redirect(`/panel/eventos/${eventId}?${ok ? 'efectivo=1' : 'error=1'}#paquetes`);
}

/**
 * Encola las invitaciones de este evento para que salgan por WhatsApp.
 *
 * Encola y nada más: quien manda es el servicio, de uno en uno, con retardo al
 * azar y tope diario. Aquí no sale un solo mensaje, y es deliberado — un botón
 * que manda doscientos de golpe es un botón que cierra el número del cliente.
 *
 * Cada invitado recibe el mensaje en SU idioma y con SU enlace, la misma regla
 * que ya seguía el envío a mano.
 */
export async function queueWhatsappAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const connectionId = String(formData.get('connectionId') ?? '');
  if (connectionId.length === 0) redirect(`/panel/eventos/${eventId}?error=1#whatsapp`);

  // La hora se escribe en el reloj de quien la escribe, y se guarda en UTC. Si
  // se interpretara con el del servidor, una oficina en Costa Rica programando
  // una boda de Beirut mandaría las invitaciones de madrugada.
  const wall = String(formData.get('scheduledAt') ?? '').trim();
  let scheduledAt: Date | null = null;
  if (wall.length > 0) {
    scheduledAt = zonedToUtc(wall, await actorTimezone(session));
    if (scheduledAt === null) redirect(`/panel/eventos/${eventId}?error=fecha#whatsapp`);
    // Una fecha pasada no se rechaza: se manda ya. Rechazarla obligaría a
    // corregir un formulario para pedir exactamente lo que ya se pedía.
    if (scheduledAt.getTime() <= Date.now()) scheduledAt = null;
  }

  const origin = `https://${requestHost(await headers())}`;
  const result = await queueEventInvitations(
    scopeOf(session),
    eventId,
    connectionId,
    (guest) => {
      const locale = LOCALES.find((candidate) => candidate === guest.locale) ?? 'ar';
      return interpolate(getDictionary(locale).share.whatsappMessage, {
        name: guest.name,
        link: `${origin}/g/${guest.token}`,
      });
    },
    session.userId,
    scheduledAt,
  );
  if ('error' in result) redirect('/panel');

  const cuando = scheduledAt === null ? '' : `&para=${encodeURIComponent(scheduledAt.toISOString())}`;
  redirect(
    `/panel/eventos/${eventId}?encolados=${result.queued}&sinTelefono=${result.skipped}${cuando}#whatsapp`,
  );
}

/**
 * Pone —o quita— el recordatorio automático de un evento.
 *
 * No manda nada ahora: escribe cuántos días antes hay que recordar. Quien mira
 * si toca es el temporizador, y quien manda sigue siendo el servicio.
 */
export async function setReminderAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const raw = String(formData.get('reminderDays') ?? '');
  const days = raw === '' ? null : Number.parseInt(raw, 10);

  await setReminder(
    scopeOf(session),
    eventId,
    days === null || !Number.isFinite(days) ? null : days,
    session.userId,
  );
  redirect(`/panel/eventos/${eventId}?recordatorio=1#whatsapp`);
}

/** Cancela una tanda programada que todavía no ha salido. */
export async function cancelScheduledAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:write') || session.tenantId === null) {
    redirect('/panel');
  }

  const eventId = String(formData.get('eventId') ?? '');
  const cancelled = await cancelScheduled(scopeOf(session), eventId, session.userId);
  redirect(`/panel/eventos/${eventId}?cancelados=${cancelled}#whatsapp`);
}

/**
 * La zona con la que se lee lo que esta persona escribe.
 *
 * La suya si la eligió, si no la del país que maneja, y si tampoco la del
 * servidor. El mismo orden que usa su propio perfil.
 */
async function actorTimezone(session: { userId: string; country: string | null }): Promise<string> {
  const user = await getPrisma().user.findUnique({
    where: { id: session.userId },
    select: { timezone: true },
  });
  if (user?.timezone != null && user.timezone.length > 0) return user.timezone;

  const country = COUNTRIES.find((entry) => entry.code === session.country);
  return country?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
