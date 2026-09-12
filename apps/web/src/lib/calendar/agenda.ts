import type { ActType } from '@/generated/prisma/enums';
import { agendaFor, publicActs, type AuthorizedAct } from '@/lib/acts/access';
import { actUid, buildCalendar, sequenceFrom, type CalendarEvent } from '@/lib/calendar/ics';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { zonedToUtc } from '@/lib/time/zoned';

/**
 * De los actos que ESTA persona puede ver al archivo de calendario.
 *
 * Quién ve qué no se decide aquí: se pregunta a `lib/acts/access.ts`, que es
 * donde vive el orden de exclusiones, grupos y visibilidad. Este módulo solo
 * traduce a `VEVENT` lo que aquello autorizó, y por eso no acepta —ni acepta
 * nunca— un `actId` venido del navegador: lo único que llega de fuera es el
 * token del invitado, y un token que no sea de este evento no es un invitado de
 * este evento.
 *
 * Sin token se sirven los actos PÚBLICOS. El archivo se descarga desde una
 * página que se reenvía a grupos enteros de WhatsApp: si la henna íntima
 * saliera ahí, daría igual lo que hiciera la pantalla.
 */

/** Lo que hace falta para titular y describir las citas, ya en su idioma. */
export interface CalendarSubject {
  /** «Boda», «Memorial»: el tipo de evento escrito en el idioma de la invitación. */
  eventName: string;
  /** Quiénes se casan o a quién se recuerda, ya unidos en una línea. */
  honorees: string;
  /** Cómo se llama cada tipo de acto en ese mismo idioma. */
  actTypeNames: Record<ActType, string>;
  /** El texto del anfitrión; es lo que se lee dentro de la cita. */
  message: string;
  /** El enlace público de la invitación. */
  url: string;
  /** Lo que trae el `Event`, para las bodas que todavía no tienen actos. */
  legacy: LegacyEvent;
}

export interface LegacyEvent {
  /**
   * El identificador de siempre, y no se toca.
   *
   * Hay invitaciones repartidas desde antes de que existieran los actos, y en la
   * agenda de sus invitados esa cita ya está guardada con ESTE UID. Cambiarlo
   * ahora no la corregiría: dejaría la vieja donde estaba y añadiría una segunda
   * al lado.
   */
  uid: string;
  date: string;
  time: string;
  timeZone: string;
  location: string;
}

/**
 * Falla con un motivo en vez de con una excepción: una fila vieja puede traer
 * una fecha que no existe —se publicaban antes de que esto se comprobara— y la
 * ruta contesta un 422, que es un fallo que se puede leer.
 */
export type CalendarResult = { ok: true; ics: string } | { ok: false; reason: 'invalid_date' };

/**
 * Lo que hace falta de un acto para escribir su cita, y nada más.
 *
 * Se nombra lo que se usa en vez de quitar lo que no: los dos caminos —la agenda
 * de un invitado y los actos públicos— devuelven formas distintas, y la segunda
 * no trae lo que solo tiene sentido con un invitado delante (su tope de
 * acompañantes, si puede contestar, lo que contestó). Escrito al revés, cada
 * campo nuevo de `AuthorizedAct` rompería este archivo sin que el calendario
 * haya cambiado en nada.
 */
type ActForCalendar = Pick<
  AuthorizedAct,
  'id' | 'type' | 'label' | 'date' | 'time' | 'endTime' | 'timezone' | 'venueName' | 'venueAddress'
>;

/** El día siguiente en el calendario, sin tocar la hora ni la zona. */
function nextDay(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Cuándo acaba un acto que dice a qué hora acaba.
 *
 * Un zaffe que empieza a las 23:00 y acaba a la 01:00 tiene la hora de fin MENOR
 * que la de inicio: acaba al día siguiente. Sin esto el `DTEND` quedaría antes
 * que el `DTSTART` y el calendario, según cuál sea, o lo rechaza o pinta una
 * cita de veintitrés horas negativas.
 *
 * Se rehace con el día siguiente y no sumando veinticuatro horas porque esa
 * noche puede ser justo la del cambio de horario, y entonces no son veinticuatro.
 */
function endsAt(act: ActForCalendar, start: Date): Date | undefined {
  if (act.endTime === null || act.endTime.length === 0) return undefined;

  const sameDay = zonedToUtc(`${act.date}T${act.endTime}`, act.timezone);
  // Una hora de fin ilegible no vale una cita entera: se cae a la duración por
  // defecto, que es lo que hacen los actos que no dicen cuándo acaban.
  if (sameDay === null) return undefined;
  if (sameDay.getTime() > start.getTime()) return sameDay;

  return zonedToUtc(`${nextDay(act.date)}T${act.endTime}`, act.timezone) ?? undefined;
}

/** El nombre del acto: como lo llama esa familia, y si no, el de su tipo. */
function nameOf(act: ActForCalendar, subject: CalendarSubject): string {
  const own = act.label?.trim() ?? '';
  return own.length > 0 ? own : subject.actTypeNames[act.type];
}

/** El evento de siempre: un solo `VEVENT` con lo que trae la fila del `Event`. */
export function legacyCalendar(subject: CalendarSubject): CalendarResult {
  const { legacy } = subject;
  const start = zonedToUtc(`${legacy.date}T${legacy.time}`, legacy.timeZone);
  if (start === null) return { ok: false, reason: 'invalid_date' };

  return {
    ok: true,
    ics: buildCalendar([
      {
        uid: legacy.uid,
        start,
        summary: `${subject.eventName} — ${subject.honorees}`,
        description: `${subject.message}\n\n${subject.url}`,
        location: legacy.location,
        url: subject.url,
      },
    ]),
  };
}

/**
 * El calendario de un evento: uno por acto autorizado, y si no hay actos, el de
 * siempre.
 *
 * Un evento sin actos no es un error ni un caso raro: son las bodas anteriores a
 * que existieran, y siguen funcionando exactamente igual que el día que se
 * repartieron.
 */
export async function calendarFor(
  scope: TenantScope,
  eventId: string,
  subject: CalendarSubject,
  options: { guestToken?: string | undefined; now?: Date } = {},
): Promise<CalendarResult> {
  const prisma = db(scope);
  const token = options.guestToken ?? '';

  // El invitado sale del token y el token tiene que ser DE ESTE evento: uno de
  // otra boda no abre la agenda de esta.
  const guest =
    token.length === 0
      ? null
      : await prisma.guest.findFirst({
          where: { token, eventId, event: scopedWhere(scope) },
          select: { id: true, maxParty: true },
        });

  const acts: ActForCalendar[] =
    guest === null
      ? await publicActs(scope, eventId)
      : await agendaFor(scope, eventId, guest, options.now ?? new Date());

  if (acts.length === 0) return legacyCalendar(subject);

  // La marca de tiempo se lee aparte y DESPUÉS, filtrada por los actos que la
  // autorización ya dejó pasar: de aquí sale el `SEQUENCE` y nada más — ni un
  // acto entra en el archivo por venir en esta consulta.
  const marks = await prisma.eventAct.findMany({
    where: { id: { in: acts.map((act) => act.id) }, eventId, event: scopedWhere(scope) },
    select: { id: true, updatedAt: true },
  });
  const changedAt = new Map(marks.map((mark) => [mark.id, mark.updatedAt]));

  const events: CalendarEvent[] = [];
  for (const act of acts) {
    // Cada acto con SU zona: una boda de Beirut puede tener la fiesta previa en
    // Costa Rica, y son ocho horas de diferencia.
    const start = zonedToUtc(`${act.date}T${act.time}`, act.timezone);
    if (start === null) return { ok: false, reason: 'invalid_date' };

    const end = endsAt(act, start);
    const changed = changedAt.get(act.id);
    events.push({
      uid: actUid(scope.tenantId, eventId, act.id),
      start,
      ...(end === undefined ? {} : { end }),
      ...(changed === undefined ? {} : { sequence: sequenceFrom(changed) }),
      summary: `${nameOf(act, subject)} — ${subject.honorees}`,
      description: `${subject.message}\n\n${subject.url}`,
      location: `${act.venueName}, ${act.venueAddress}`,
      url: subject.url,
    });
  }

  return { ok: true, ics: buildCalendar(events) };
}
