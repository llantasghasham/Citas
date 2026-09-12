import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

/**
 * Los grupos de invitados: «familia de la novia», «trabajo», «VIP».
 *
 * Es lo que hace que asignar cuatrocientas personas a cinco actos no sean
 * cuatrocientas decisiones. El grupo se asigna al acto una vez; las excepciones
 * se escriben con nombre y apellido y son pocas.
 */

export interface SegmentRow {
  id: string;
  key: string;
  name: string;
  members: number;
}

export async function readSegments(
  scope: TenantScope,
  eventId: string,
): Promise<SegmentRow[] | null> {
  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const segments = await prisma.audienceSegment.findMany({
    where: { eventId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, key: true, name: true, _count: { select: { members: true } } },
  });
  return segments.map((segment) => ({
    id: segment.id,
    key: segment.key,
    name: segment.name,
    members: segment._count.members,
  }));
}

/**
 * La clave estable de un grupo, para poder nombrarlo en un CSV.
 *
 * Sale del nombre SOLO cuando el nombre tiene letras latinas. Un grupo llamado
 * «عائلة العروس» no se translitera: sale `grupo-3`. Transliterar un nombre árabe
 * automáticamente es exactamente lo que este proyecto prohíbe en los slugs, y no
 * hay razón para hacerlo aquí y no allí.
 */
export function segmentKey(name: string, taken: readonly string[]): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

  const base = ascii.length > 0 ? ascii : 'grupo';
  if (!taken.includes(base)) return base;
  for (let number = 2; number < 500; number += 1) {
    const candidate = `${base}-${number}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function addSegment(
  scope: TenantScope,
  eventId: string,
  name: string,
  actorId: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'notFound' | 'name' }> {
  const clean = name.trim().slice(0, 60);
  if (clean.length === 0) return { ok: false, reason: 'name' };

  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return { ok: false, reason: 'notFound' };

  const taken = await prisma.audienceSegment.findMany({
    where: { eventId },
    select: { key: true },
  });
  const segment = await prisma.audienceSegment.create({
    data: { eventId, key: segmentKey(clean, taken.map((row) => row.key)), name: clean },
    select: { id: true },
  });

  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'segment.add',
    entity: 'AudienceSegment',
    entityId: segment.id,
    metadata: { eventId, name: clean },
  });
  return { ok: true, id: segment.id };
}

/**
 * Quita un grupo, con sus pertenencias y sus reglas.
 *
 * Los invitados NO se van con él: el grupo es una etiqueta, no un sitio donde
 * vivan. Quien se quede sin ningún grupo deja de entrar a los actos que solo se
 * abrían por ese grupo, y eso sale en la pantalla antes de confirmar.
 */
export async function removeSegment(
  scope: TenantScope,
  eventId: string,
  segmentId: string,
  actorId: string,
): Promise<boolean> {
  const prisma = db(scope);
  const segment = await prisma.audienceSegment.findFirst({
    where: { id: segmentId, eventId, event: scopedWhere(scope) },
    select: { id: true, name: true },
  });
  if (segment === null) return false;

  await prisma.audienceSegment.delete({ where: { id: segment.id } });
  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'segment.remove',
    entity: 'AudienceSegment',
    entityId: segmentId,
    metadata: { eventId, name: segment.name },
  });
  return true;
}

/** Mete o saca a un invitado de un grupo. Los dos tienen que ser del evento. */
export async function setGuestSegment(
  scope: TenantScope,
  eventId: string,
  guestId: string,
  segmentId: string,
  member: boolean,
): Promise<boolean> {
  const prisma = db(scope);

  // Las dos comprobaciones a la vez, y las dos contra el evento: un id de
  // invitado de otra boda no encuentra fila y aquí se acaba.
  const [guest, segment] = await Promise.all([
    prisma.guest.findFirst({
      where: { id: guestId, eventId, event: scopedWhere(scope) },
      select: { id: true },
    }),
    prisma.audienceSegment.findFirst({
      where: { id: segmentId, eventId, event: scopedWhere(scope) },
      select: { id: true },
    }),
  ]);
  if (guest === null || segment === null) return false;

  if (member) {
    await prisma.guestSegment.upsert({
      where: { guestId_segmentId: { guestId, segmentId } },
      update: {},
      create: { guestId, segmentId, eventId },
    });
  } else {
    await prisma.guestSegment.deleteMany({ where: { guestId, segmentId } });
  }
  return true;
}

/** Mete a TODOS los invitados del evento en un grupo, de una vez. */
export async function fillSegment(
  scope: TenantScope,
  eventId: string,
  segmentId: string,
): Promise<number> {
  const prisma = db(scope);
  const segment = await prisma.audienceSegment.findFirst({
    where: { id: segmentId, eventId, event: scopedWhere(scope) },
    select: { id: true },
  });
  if (segment === null) return 0;

  const guests = await prisma.guest.findMany({ where: { eventId }, select: { id: true } });
  const { count } = await prisma.guestSegment.createMany({
    data: guests.map((guest) => ({ guestId: guest.id, segmentId, eventId })),
    skipDuplicates: true,
  });
  return count;
}

export interface AssignableGuest {
  id: string;
  name: string;
  phone: string | null;
  locale: string;
  /** Los grupos en los que ya está, para marcar las casillas. */
  segmentIds: string[];
}

/**
 * Los invitados del evento con los grupos en los que están.
 *
 * Dos consultas y no una por invitado: una boda de cuatrocientos serían
 * cuatrocientas consultas para pintar una lista de casillas.
 */
export async function listGuestsForAssignment(
  scope: TenantScope,
  eventId: string,
): Promise<AssignableGuest[] | null> {
  const prisma = db(scope);
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...scopedWhere(scope) },
    select: { id: true },
  });
  if (event === null) return null;

  const [guests, memberships] = await Promise.all([
    prisma.guest.findMany({
      where: { eventId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, locale: true },
    }),
    prisma.guestSegment.findMany({ where: { eventId }, select: { guestId: true, segmentId: true } }),
  ]);

  const groupsOf = new Map<string, string[]>();
  for (const row of memberships) {
    const list = groupsOf.get(row.guestId) ?? [];
    list.push(row.segmentId);
    groupsOf.set(row.guestId, list);
  }

  return guests.map((guest) => ({
    id: guest.id,
    name: guest.name,
    phone: guest.phone,
    locale: guest.locale,
    segmentIds: groupsOf.get(guest.id) ?? [],
  }));
}

/**
 * Deja el grupo con EXACTAMENTE estos invitados dentro.
 *
 * Reemplaza, no añade, porque eso es lo que hace un formulario de casillas: una
 * casilla que se desmarca no manda nada, así que «lo que llega» es la lista
 * entera y lo que falta es lo que se quitó. Añadir sin quitar haría que
 * desmarcar no sirviera para nada, que es peor que no tener la casilla.
 *
 * Los ids llegan de un formulario, así que se cruzan contra los invitados DEL
 * EVENTO antes de escribir: un id de la boda de otra oficina no sobrevive al
 * filtro y no llega a la escritura.
 */
export async function setSegmentMembers(
  scope: TenantScope,
  eventId: string,
  segmentId: string,
  guestIds: readonly string[],
): Promise<{ added: number; removed: number } | null> {
  const prisma = db(scope);

  const segment = await prisma.audienceSegment.findFirst({
    where: { id: segmentId, eventId, event: scopedWhere(scope) },
    select: { id: true },
  });
  if (segment === null) return null;

  const wanted = await prisma.guest.findMany({
    where: { eventId, id: { in: [...guestIds] } },
    select: { id: true },
  });
  const keep = new Set(wanted.map((guest) => guest.id));

  const current = await prisma.guestSegment.findMany({
    where: { segmentId },
    select: { guestId: true },
  });
  const have = new Set(current.map((row) => row.guestId));

  const toAdd = [...keep].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !keep.has(id));

  // En una transacción: dejar el grupo a medias entre quitar y poner sería
  // dejar a gente fuera de actos a los que sí estaba invitada, y eso se
  // descubre cuando alguien no recibe su invitación.
  await prisma.$transaction([
    prisma.guestSegment.deleteMany({ where: { segmentId, guestId: { in: toRemove } } }),
    prisma.guestSegment.createMany({
      data: toAdd.map((guestId) => ({ guestId, segmentId, eventId })),
      skipDuplicates: true,
    }),
  ]);

  return { added: toAdd.length, removed: toRemove.length };
}
