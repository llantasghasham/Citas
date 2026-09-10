import { recordAudit } from '@/lib/audit';
import { getPrisma } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { toE164 } from '@/lib/guests/phone';
import { setting } from '@/lib/settings';
import { zonedToUtc } from '@/lib/time/zoned';
import { getDictionary, interpolate, LOCALES, type Locale } from '@citas/core';

/**
 * El recordatorio a quien no ha contestado.
 *
 * Es lo que decide si una boda sabe cuánta gente va. Un invitado que abrió el
 * enlace y no contestó no es un «no»: es alguien que iba a hacerlo luego y se
 * le olvidó. Perseguir eso a mano en una lista de doscientos no lo hace nadie,
 * y por eso hasta ahora sencillamente no se hacía.
 *
 * Lo que este archivo hace es ENCOLAR, igual que el botón de la pantalla. Quien
 * manda sigue siendo el servicio de WhatsApp, de uno en uno y con su freno: la
 * regla del proyecto es que la web escribe filas y nadie más manda, y un
 * recordatorio automático es justo el sitio donde saltársela costaría el número
 * del cliente.
 */

/** Se recuerda UNA vez. Dos veces lo mismo deja de ser un recordatorio. */
export interface ReminderOutcome {
  events: number;
  queued: number;
}

/** Los días que se ofrecen. No es un campo libre: «45» no es un recordatorio. */
export const REMINDER_DAYS = [15, 7, 3, 2, 1] as const;

export async function setReminder(
  scope: TenantScope,
  eventId: string,
  days: number | null,
  actorId: string,
): Promise<void> {
  const safe = days === null ? null : (REMINDER_DAYS.find((d) => d === days) ?? null);

  const { count } = await getPrisma().event.updateMany({
    where: { id: eventId, ...scopedWhere(scope) },
    data: { reminderDaysBefore: safe },
  });
  if (count === 0) return;

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'whatsapp.reminder.set',
    entity: 'Event',
    entityId: eventId,
    metadata: { days: safe },
  });
}

/**
 * Recorre los eventos con recordatorio puesto y encola lo que toque.
 *
 * Sin oficina, a propósito, y es la única función del proyecto que trabaja así
 * aparte de las dos ya discutidas: no la llama nadie con sesión, la llama un
 * temporizador del sistema. No devuelve datos de ninguna oficina ni los cruza —
 * cada mensaje se escribe con el `tenantId` del evento del que sale— y no hay
 * ninguna entrada por la que un usuario pueda alcanzarla.
 */
export async function queueDueReminders(now = new Date()): Promise<ReminderOutcome> {
  const prisma = getPrisma();
  const origin = (await setting('NEXT_PUBLIC_SITE_URL'))?.replace(/\/$/, '');
  if (origin === undefined || origin.length === 0) {
    throw new Error('Falta la dirección del sitio: el enlace del invitado no se puede escribir.');
  }

  const events = await prisma.event.findMany({
    where: { reminderDaysBefore: { not: null } },
    select: {
      id: true,
      tenantId: true,
      date: true,
      time: true,
      timezone: true,
      reminderDaysBefore: true,
      guests: {
        // A quien no ha contestado, tiene teléfono y no se le ha recordado ya.
        where: { rsvp: null, phone: { not: null }, remindedAt: null },
        select: { id: true, name: true, phone: true, token: true, locale: true },
      },
    },
  });

  const outcome: ReminderOutcome = { events: 0, queued: 0 };

  for (const event of events) {
    if (event.reminderDaysBefore === null || event.guests.length === 0) continue;

    // La fecha del evento es la hora LOCAL DEL LUGAR, guardada como texto para
    // que ninguna conversión la desplace. Aquí hay que convertirla, y con la
    // zona del evento: «tres días antes» de una boda en Beirut no lo decide el
    // reloj del servidor.
    const start = zonedToUtc(`${event.date}T${event.time}`, event.timezone);
    if (start === null) continue;

    const dueAt = start.getTime() - event.reminderDaysBefore * 24 * 60 * 60 * 1000;
    // Ni antes de tiempo, ni después de la boda: recordarle a alguien que
    // confirme su asistencia a una boda que ya pasó es peor que no escribirle.
    if (now.getTime() < dueAt || now.getTime() >= start.getTime()) continue;

    const connection = await prisma.whatsappConnection.findFirst({
      where: { tenantId: event.tenantId, status: 'connected' },
      orderBy: { isDefault: 'desc' },
      select: { id: true },
    });
    // Sin número conectado no hay por dónde mandarlo. No se marca a nadie como
    // recordado: cuando la oficina conecte uno, la siguiente pasada lo hará.
    if (connection === null) continue;

    const rows = event.guests.flatMap((guest) => {
      const phone = guest.phone === null ? null : toE164(guest.phone, '+961');
      if (phone === null) return [];

      const locale: Locale = LOCALES.find((candidate) => candidate === guest.locale) ?? 'ar';
      return [
        {
          tenantId: event.tenantId,
          connectionId: connection.id,
          eventId: event.id,
          guestId: guest.id,
          toPhone: phone,
          // En el idioma DEL INVITADO, como todo lo que sale de aquí.
          body: interpolate(getDictionary(locale).share.reminderMessage, {
            name: guest.name,
            link: `${origin}/g/${guest.token}`,
          }),
        },
      ];
    });
    if (rows.length === 0) continue;

    // Se marca y se encola a la vez: si se cayera entre las dos cosas, o se
    // recordaría dos veces o no se recordaría nunca, y las dos son peores que
    // fallar entera y volver a intentarlo en la siguiente pasada.
    // Se RECLAMAN los invitados antes de escribirles, y solo se escribe a los
    // que se hayan podido reclamar.
    //
    // El orden importa y antes estaba al revés: se creaban los mensajes y luego
    // se marcaba. Dos repasos a la vez seleccionaban al mismo invitado y los dos
    // le escribían. Y peor: entre la selección y la marca podía llegar su
    // confirmación, así que se le recordaba que confirmara algo que ya había
    // confirmado.
    //
    // `updateMany` con `remindedAt: null` en el WHERE es atómico: de dos
    // procesos, uno cuenta la fila y el otro no. La condición del RSVP se
    // vuelve a comprobar aquí por lo mismo.
    const queued = await prisma.$transaction(async (tx) => {
      const claimed = await tx.guest.updateMany({
        where: {
          id: { in: rows.map((row) => row.guestId) },
          remindedAt: null,
          rsvp: null,
        },
        data: { remindedAt: now },
      });
      if (claimed.count === 0) return 0;

      // Solo los que siguen sin marca ajena: se releen dentro de la misma
      // transacción, ya marcados por nosotros.
      const mine = await tx.guest.findMany({
        where: { id: { in: rows.map((row) => row.guestId) }, remindedAt: now },
        select: { id: true },
      });
      const ids = new Set(mine.map((guest) => guest.id));
      const toWrite = rows.filter((row) => ids.has(row.guestId));
      if (toWrite.length === 0) return 0;

      await tx.whatsappMessage.createMany({ data: toWrite });
      return toWrite.length;
    });
    if (queued === 0) continue;

    await recordAudit({
      tenantId: event.tenantId,
      action: 'whatsapp.reminder.queue',
      entity: 'Event',
      entityId: event.id,
      metadata: { queued, days: event.reminderDaysBefore },
    });

    outcome.events += 1;
    outcome.queued += queued;
  }

  return outcome;
}
