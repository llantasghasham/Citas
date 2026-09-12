import type { ActType, ActVisibility, AudienceMode } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import { isCalendarDate, isClockTime, zonedToUtc } from '@/lib/time/zoned';

/**
 * Crear, editar, ordenar y quitar actos, y decidir qué grupos entran a cada uno.
 *
 * Todo pasa por el `TenantScope` y por el `eventId`, y las dos cosas se
 * comprueban ANTES de tocar nada: el id del acto viaja en un campo oculto de un
 * formulario, así que es un dato del cliente como cualquier otro.
 */

export const ACT_TYPES = [
  'engagement',
  'family_party',
  'henna',
  'preparation',
  'zaffe',
  'ceremony',
  'dinner',
  'reception',
  'farewell',
  'other',
] as const;

export interface ActRow {
  id: string;
  type: ActType;
  label: string | null;
  order: number;
  date: string;
  time: string;
  endTime: string | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
  venueMapUrl: string;
  capacity: number | null;
  optional: boolean;
  rsvpEnabled: boolean;
  rsvpDeadline: Date | null;
  visibility: ActVisibility;
  isMain: boolean;
  /** Los grupos que entran y los que no, para pintarlos sin otra consulta. */
  audiences: { segmentId: string; mode: AudienceMode }[];
}

/*
 * Los RECUENTOS no están aquí a propósito.
 *
 * Estuvieron, y eran una aproximación: sumaban la gente de cada grupo permitido,
 * así que quien estuviera en dos se contaba dos veces y una exclusión con nombre
 * no restaba. Al lado, `lib/acts/metrics.ts` los calcula EXACTOS aplicando la
 * misma regla que decide la agenda. Dos cifras para lo mismo, una de ellas
 * mentirosa, es como se pierde la confianza en una pantalla entera — así que la
 * aproximada se fue y queda una.
 */

export interface ActInput {
  type: string;
  label: string;
  date: string;
  time: string;
  endTime: string;
  timezone: string;
  venueName: string;
  venueAddress: string;
  venueMapUrl: string;
  capacity: string;
  optional: boolean;
  rsvpEnabled: boolean;
  rsvpDeadline: string;
  visibility: string;
}

export type ActProblem =
  | 'type'
  | 'date'
  | 'time'
  | 'endTime'
  | 'venue'
  | 'capacity'
  | 'deadline'
  | 'notFound'
  | 'lastOne';

/** Que el evento sea de esta oficina. Nada más se toca si esto no pasa. */
async function ownedEvent(scope: TenantScope, eventId: string): Promise<string | null> {
  const event = await db(scope).event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  return event?.id ?? null;
}

/** Los actos de un evento, con lo que hace falta para pintarlos y decidir. */
export async function readActs(scope: TenantScope, eventId: string): Promise<ActRow[] | null> {
  if ((await ownedEvent(scope, eventId)) === null) return null;
  const prisma = db(scope);

  const acts = await prisma.eventAct.findMany({
    where: { eventId },
    orderBy: [{ order: 'asc' }, { date: 'asc' }, { time: 'asc' }],
    include: { audiences: { select: { segmentId: true, mode: true } } },
  });
  if (acts.length === 0) return [];

  return acts.map((act) => ({
    id: act.id,
    type: act.type,
    label: act.label,
    order: act.order,
    date: act.date,
    time: act.time,
    endTime: act.endTime,
    timezone: act.timezone,
    venueName: act.venueName,
    venueAddress: act.venueAddress,
    venueMapUrl: act.venueMapUrl,
    capacity: act.capacity,
    optional: act.optional,
    rsvpEnabled: act.rsvpEnabled,
    rsvpDeadline: act.rsvpDeadline,
    visibility: act.visibility,
    isMain: act.isMain,
    audiences: act.audiences,
  }));
}

/**
 * Lo que hay mal en un acto, en el servidor.
 *
 * La fecha se comprueba contra el CALENDARIO y no contra una expresión: un 30
 * de febrero pasa cualquier regex y `Date.parse` lo corre al 2 de marzo sin
 * protestar, así que un acto saldría otro día sin que nadie se entere.
 */
export function actProblems(input: ActInput): ActProblem[] {
  const problems: ActProblem[] = [];
  if (!ACT_TYPES.some((type) => type === input.type)) problems.push('type');
  if (!isCalendarDate(input.date)) problems.push('date');
  if (!isClockTime(input.time)) problems.push('time');
  if (input.endTime.length > 0 && !isClockTime(input.endTime)) problems.push('endTime');
  if (input.venueName.trim().length === 0 || input.venueAddress.trim().length === 0) {
    problems.push('venue');
  }
  if (input.capacity.length > 0) {
    const capacity = Number.parseInt(input.capacity, 10);
    if (!Number.isInteger(capacity) || capacity < 1) problems.push('capacity');
  }

  // Un plazo que vence DESPUÉS de la fiesta no es un plazo. Se compara en la
  // zona del acto, que es la que decide cuándo empieza de verdad.
  if (input.rsvpDeadline.length > 0) {
    if (!isCalendarDate(input.rsvpDeadline)) {
      problems.push('deadline');
    } else if (problems.length === 0) {
      const starts = zonedToUtc(`${input.date}T${input.time}`, input.timezone);
      const closes = zonedToUtc(`${input.rsvpDeadline}T23:59`, input.timezone);
      if (starts === null || closes === null || closes.getTime() > starts.getTime()) {
        problems.push('deadline');
      }
    }
  }
  return problems;
}

function fields(input: ActInput): {
  type: ActType;
  label: string | null;
  date: string;
  time: string;
  endTime: string | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
  venueMapUrl: string;
  capacity: number | null;
  optional: boolean;
  rsvpEnabled: boolean;
  rsvpDeadline: Date | null;
  visibility: ActVisibility;
} {
  const label = input.label.trim();
  return {
    type: input.type as ActType,
    label: label.length === 0 ? null : label,
    date: input.date,
    time: input.time,
    endTime: input.endTime.length === 0 ? null : input.endTime,
    timezone: input.timezone,
    venueName: input.venueName.trim(),
    venueAddress: input.venueAddress.trim(),
    venueMapUrl: input.venueMapUrl.trim(),
    capacity: input.capacity.length === 0 ? null : Number.parseInt(input.capacity, 10),
    optional: input.optional,
    rsvpEnabled: input.rsvpEnabled,
    rsvpDeadline:
      input.rsvpDeadline.length === 0 ? null : new Date(`${input.rsvpDeadline}T23:59:59Z`),
    visibility: input.visibility === 'public' ? 'public' : 'segmented',
  };
}

export async function addAct(
  scope: TenantScope,
  eventId: string,
  input: ActInput,
  actorId: string,
): Promise<{ ok: true; id: string } | { ok: false; problems: ActProblem[] }> {
  if ((await ownedEvent(scope, eventId)) === null) return { ok: false, problems: ['notFound'] };
  const problems = actProblems(input);
  if (problems.length > 0) return { ok: false, problems };

  const prisma = db(scope);
  const last = await prisma.eventAct.findFirst({
    where: { eventId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const act = await prisma.eventAct.create({
    data: { eventId, order: (last?.order ?? -1) + 1, ...fields(input) },
    select: { id: true },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'act.add',
    entity: 'EventAct',
    entityId: act.id,
    metadata: { eventId, type: input.type, visibility: input.visibility },
  });
  return { ok: true, id: act.id };
}

export async function editAct(
  scope: TenantScope,
  eventId: string,
  actId: string,
  input: ActInput,
  actorId: string,
): Promise<{ ok: true } | { ok: false; problems: ActProblem[] }> {
  if ((await ownedEvent(scope, eventId)) === null) return { ok: false, problems: ['notFound'] };
  const problems = actProblems(input);
  if (problems.length > 0) return { ok: false, problems };

  // `updateMany` con el evento dentro: un id de acto de otra boda no encuentra
  // fila y no escribe nada, en vez de encontrarla y escribirla.
  const { count } = await db(scope).eventAct.updateMany({
    where: { id: actId, eventId },
    data: fields(input),
  });
  if (count === 0) return { ok: false, problems: ['notFound'] };

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'act.edit',
    entity: 'EventAct',
    entityId: actId,
    metadata: { eventId, type: input.type, visibility: input.visibility },
  });
  return { ok: true };
}

/**
 * Sube o baja un acto en la agenda.
 *
 * Se intercambian los dos `order` dentro de una transacción. No hay índice único
 * sobre `order` justamente para que este intercambio no tenga que pasar por un
 * valor temporal para no chocar consigo mismo.
 */
export async function moveAct(
  scope: TenantScope,
  eventId: string,
  actId: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  if ((await ownedEvent(scope, eventId)) === null) return false;
  const prisma = db(scope);

  const act = await prisma.eventAct.findFirst({
    where: { id: actId, eventId },
    select: { id: true, order: true },
  });
  if (act === null) return false;

  const neighbour = await prisma.eventAct.findFirst({
    where:
      direction === 'up'
        ? { eventId, order: { lt: act.order } }
        : { eventId, order: { gt: act.order } },
    orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, order: true },
  });
  if (neighbour === null) return false;

  await prisma.$transaction([
    prisma.eventAct.update({ where: { id: act.id }, data: { order: neighbour.order } }),
    prisma.eventAct.update({ where: { id: neighbour.id }, data: { order: act.order } }),
  ]);
  return true;
}

/**
 * Quita un acto, con sus invitaciones y sus respuestas.
 *
 * El acto PRINCIPAL no se quita. Es el que heredó lo que el evento era antes de
 * que existieran los actos y el que decide la respuesta global; quitarlo dejaría
 * las mesas y la exportación mirando a algo que ya no está. Para dejar de usarlo
 * se le cambia el tipo, la fecha o la audiencia — que es lo que de verdad se
 * quiere hacer.
 */
export async function removeAct(
  scope: TenantScope,
  eventId: string,
  actId: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; reason: 'notFound' | 'main' }> {
  if ((await ownedEvent(scope, eventId)) === null) return { ok: false, reason: 'notFound' };
  const prisma = db(scope);

  const act = await prisma.eventAct.findFirst({
    where: { id: actId, eventId },
    select: { id: true, isMain: true, type: true },
  });
  if (act === null) return { ok: false, reason: 'notFound' };
  if (act.isMain) return { ok: false, reason: 'main' };

  await prisma.eventAct.delete({ where: { id: act.id } });
  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'act.remove',
    entity: 'EventAct',
    entityId: actId,
    metadata: { eventId, type: act.type },
  });
  return { ok: true };
}

/**
 * Pone, cambia o quita la regla de un grupo sobre un acto.
 *
 * `none` la quita. Es lo mismo que no tenerla: sin regla, ese grupo no entra —
 * salvo que el acto sea público o alguien tenga invitación con nombre.
 */
export async function setActAudience(
  scope: TenantScope,
  eventId: string,
  actId: string,
  segmentId: string,
  mode: AudienceMode | 'none',
  actorId: string,
): Promise<boolean> {
  if ((await ownedEvent(scope, eventId)) === null) return false;
  const prisma = db(scope);

  const [act, segment] = await Promise.all([
    prisma.eventAct.findFirst({ where: { id: actId, eventId }, select: { id: true } }),
    prisma.audienceSegment.findFirst({ where: { id: segmentId, eventId }, select: { id: true } }),
  ]);
  if (act === null || segment === null) return false;

  if (mode === 'none') {
    await prisma.actAudience.deleteMany({ where: { actId, segmentId } });
  } else {
    await prisma.actAudience.upsert({
      where: { actId_segmentId: { actId, segmentId } },
      update: { mode },
      create: { actId, segmentId, eventId, mode },
    });
  }

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'act.audience',
    entity: 'EventAct',
    entityId: actId,
    metadata: { eventId, segmentId, mode },
  });
  return true;
}
